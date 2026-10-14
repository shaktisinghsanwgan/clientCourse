var CourseApi = (function () {
  var BASE_URL = 'https://web-production-b4f12.up.railway.app';
  var ADMIN_API_KEY = 'local-dev-admin-key';
  var STORAGE_KEY = 'courseSync.purchaser';
  var PROFILE_FLAG = 'courseSync.needProfile';
  var kajabiUserId = '';
  var accountUserId = '';
  var identityReady = false;
  var pendingCompletion = null;

  function request(path, options) {
    var settings = options || {};
    var headers = {};
    if (settings.body !== undefined) headers['Content-Type'] = 'application/json';
    if (settings.admin) headers['X-Api-Key'] = ADMIN_API_KEY;
    if (settings.token) headers.Authorization = 'Bearer ' + settings.token;

    return fetch(BASE_URL + path, {
      method: settings.method || 'GET',
      headers: headers,
      keepalive: Boolean(settings.keepalive),
      body: settings.body === undefined ? undefined : JSON.stringify(settings.body),
    }).then(function (response) {
      return response.text().then(function (text) {
        var data = text ? JSON.parse(text) : null;
        if (!response.ok) {
          var error = new Error((data && data.message) || ('Request failed (' + response.status + ')'));
          error.status = response.status;
          error.body = data;
          throw error;
        }
        return data;
      });
    });
  }

  function compact(body) {
    var payload = {};
    Object.keys(body).forEach(function (key) {
      if (body[key] !== undefined && body[key] !== null && body[key] !== '') payload[key] = body[key];
    });
    return payload;
  }

  function readCookie(name) {
    var pieces = document.cookie ? document.cookie.split(';') : [];
    for (var index = 0; index < pieces.length; index += 1) {
      var piece = pieces[index].trim();
      if (piece.indexOf(name + '=') === 0) return decodeURIComponent(piece.slice(name.length + 1));
    }
    return '';
  }

  function savedPurchaser() {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
    } catch (error) {
      return null;
    }
  }

  function savePurchaser(result) {
    var data = result.data || result;
    var user = data.user || {};
    var record = {
      id: user.id || data.userId,
      name: user.name || data.name,
      email: user.email || data.email,
      token: data.token || '',
      role: user.role || data.role || '',
      kajabiUserId: user.kajabiUserId || data.kajabiUserId || readCookie('rl_user_id'),
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(record));
    return record;
  }

  function fieldValue(selector) {
    var field = document.querySelector(selector);
    return field && field.value ? field.value.trim() : '';
  }

  function memberFromPage() {
    return {
      name: fieldValue('#member_name, input[name="member[name]"]'),
      email: fieldValue('#member_email, input[name="member[email]"]'),
    };
  }

  function isSettingsPage() {
    return /\/settings\/account/.test(window.location.pathname);
  }

  function isThankYouPage() {
    return /thank[-_ ]?you/i.test(window.location.pathname);
  }

  function isMissingIdentity(error) {
    var code = error && error.body && error.body.errorCode;
    return Boolean(error && (error.status === 404 || code === 'IDENTITY_NOT_FOUND' || /user not found/i.test(error.message || '')));
  }

  function isCheckoutPage() {
    return /\/offers\/[^/]+\/checkout/i.test(window.location.pathname);
  }

  function checkoutEmail() {
    var custom = document.querySelector('pds-input[component-id="email"]');
    if (custom && custom.value) return String(custom.value).trim();
    if (custom && custom.shadowRoot) {
      var inner = custom.shadowRoot.querySelector('input');
      if (inner && inner.value) return inner.value.trim();
    }
    var input = document.querySelector('input[type="email"]');
    return input && input.value ? input.value.trim() : '';
  }

  function checkoutName() {
    var input = document.querySelector('#name');
    return input && input.value ? input.value.trim() : '';
  }

  function rememberCheckoutPurchaser() {
    var name = checkoutName();
    var email = checkoutEmail();
    if (!name && !email) return savedPurchaser();
    var existing = savedPurchaser() || {};
    var next = {
      id: existing.id,
      name: name || existing.name || '',
      email: email || existing.email || '',
      token: existing.token,
      role: existing.role,
      kajabiUserId: existing.kajabiUserId,
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    return next;
  }

  function watchCheckout() {
    function capture(event) {
      var path = event && event.composedPath ? event.composedPath() : [];
      var name = '';
      var email = '';
      for (var index = 0; index < path.length; index += 1) {
        var node = path[index];
        if (!node || node.tagName !== 'INPUT' || !node.value) continue;
        var host = null;
        for (var hostIndex = index; hostIndex < path.length; hostIndex += 1) {
          if (path[hostIndex] && path[hostIndex].tagName === 'PDS-INPUT') {
            host = path[hostIndex];
            break;
          }
        }
        if (node.id === 'name' || node.getAttribute('testid') === 'name-input') name = node.value.trim();
        if (node.type === 'email' || (host && host.getAttribute('component-id') === 'email')) email = node.value.trim();
      }
      if (name || email) {
        var existing = savedPurchaser() || {};
        localStorage.setItem(STORAGE_KEY, JSON.stringify({
          id: existing.id,
          name: name || checkoutName() || existing.name || '',
          email: email || checkoutEmail() || existing.email || '',
          token: existing.token,
          role: existing.role,
          kajabiUserId: existing.kajabiUserId,
        }));
      }
      rememberCheckoutPurchaser();
    }
    document.addEventListener('input', capture, true);
    document.addEventListener('change', capture, true);
    window.setInterval(rememberCheckoutPurchaser, 1000);
    document.addEventListener('click', function (event) {
      var node = event.target && event.target.nodeType === 1 ? event.target : event.target && event.target.parentElement;
      if (!node || !node.closest) return;
      var button = node.closest('[data-testid="popup-submit-button"]');
      if (!button) return;
      var draft = rememberCheckoutPurchaser();
      if (!draft || !draft.name || !draft.email) return;
      CourseApi.registerPurchaser({ name: draft.name, email: draft.email }, { keepalive: true }).then(savePurchaser);
    }, true);
  }

  function isLessonPage() {
    return /\/posts\/\d+/.test(window.location.pathname) || Boolean(document.querySelector('.mark-as-complete, .btn--completion'));
  }

  function siteMemberId() {
    var siteUser = window.Kajabi && window.Kajabi.currentSiteUser;
    if (!siteUser || siteUser.id == null || String(siteUser.id) === '-1') return '';
    return String(siteUser.id);
  }

  function identityCandidates() {
    var ids = [];
    function add(id) {
      if (id == null) return;
      var value = String(id).trim();
      if (!value || value === '-1' || ids.indexOf(value) !== -1) return;
      ids.push(value);
    }
    add(readCookie('rl_user_id'));
    try {
      add(localStorage.getItem('courseSync.linkedId'));
    } catch (error) {
      /* storage can be blocked */
    }
    var saved = savedPurchaser();
    if (saved) add(saved.kajabiUserId);
    add(siteMemberId());
    return ids;
  }

  function cleanText(node) {
    return node ? node.textContent.replace(/\s+/g, ' ').trim() : '';
  }

  function playlistRoot(node) {
    if (node && node.closest) {
      var found = node.closest('.playlist');
      if (found) return found;
    }
    var active = document.querySelector('.playlist .track--active');
    if (active && active.closest) return active.closest('.playlist');
    var playlists = document.querySelectorAll('.playlist');
    return playlists.length === 1 ? playlists[0] : null;
  }

  function playlistTitle(playlist) {
    if (!playlist) return '';
    return cleanText(playlist.querySelector('.playlist__title h2, .playlist__title'));
  }

  function weekNumberFromPlaylist(playlist) {
    var match = playlistTitle(playlist).match(/Week\s+(\d+)/i);
    if (match) return Number(match[1]);
    var playlists = document.querySelectorAll('.playlist');
    if (playlist && playlists.length > 1) {
      for (var index = 0; index < playlists.length; index += 1) {
        if (playlists[index] === playlist) return index + 1;
      }
    }
    if (!playlist || playlists.length <= 1) {
      var subtitle = document.querySelector('.panel__sub-title');
      var subtitleMatch = cleanText(subtitle).match(/Week\s+(\d+)/i);
      if (subtitleMatch) return Number(subtitleMatch[1]);
    }
    return 0;
  }

  function readLesson() {
    var heading = document.querySelector('h1.panel__title, h1');
    var postMatch = window.location.pathname.match(/posts\/(\d+)/);
    return {
      title: cleanText(heading),
      weekNumber: weekNumberFromPlaylist(playlistRoot()),
      chapterId: postMatch ? postMatch[1] : '',
    };
  }

  function moduleLessons(playlist) {
    var root = playlist || playlistRoot();
    var weekNumber = weekNumberFromPlaylist(root);
    if (!root) return [];
    var tracks = root.querySelectorAll('a.track');
    var lessons = [];
    for (var index = 0; index < tracks.length; index += 1) {
      var track = tracks[index];
      if (track.classList.contains('track--more') || track.querySelector('.track__more')) continue;
      var href = track.getAttribute('href') || '';
      var postMatch = href.match(/posts\/(\d+)/);
      lessons.push({
        title: cleanText(track.querySelector('.track__title')),
        weekNumber: weekNumber,
        chapterId: postMatch ? postMatch[1] : '',
        completed: Boolean(track.querySelector('.fa-check')),
      });
    }
    return lessons;
  }

  function findWeek(person, weekNumber) {
    var weeks = person && person.weeks ? person.weeks : [];
    for (var index = 0; index < weeks.length; index += 1) {
      if (Number(weeks[index].weekNumber) === Number(weekNumber)) return weeks[index];
    }
    return weeks[weekNumber - 1] || null;
  }

  function incompleteNames(week) {
    if (!week || !week.chapters) return [];
    return week.chapters.filter(function (chapter) {
      return !chapter.completed;
    }).map(function (chapter) {
      return chapter.chapterName;
    });
  }

  function chapterLines(week) {
    if (!week || !week.chapters) return [];
    return week.chapters.map(function (chapter) {
      return chapter.chapterName + (chapter.completed ? ' — done' : ' — not done');
    });
  }

  function otherRole(course) {
    if (course && course.synchronization && course.synchronization.otherRole) return course.synchronization.otherRole;
    if (course && course.otherRole) return course.otherRole;
    var saved = savedPurchaser();
    return saved && saved.role === 'PARTNER' ? 'purchaser' : 'partner';
  }

  function ensureModal() {
    var existing = document.getElementById('course-sync-modal');
    if (existing) return existing;
    var style = document.createElement('style');
    style.textContent = ''
      + '#course-sync-modal{position:fixed;inset:0;z-index:99999;display:none;align-items:center;justify-content:center;background:rgba(28,22,18,.55);padding:16px;overflow:hidden;}'
      + '#course-sync-modal.is-open{display:flex;}'
      + '#course-sync-modal .course-sync-card{width:min(520px,100%);max-height:calc(100vh - 32px);overflow:hidden;background:#fffaf6;color:#2b211c;border-radius:16px;padding:22px 24px;box-shadow:0 20px 50px rgba(0,0,0,.2);font-family:Georgia,serif;}'
      + '#course-sync-modal h2{margin:0 0 6px;font-size:24px;line-height:1.2;}'
      + '#course-sync-modal p{margin:0 0 10px;line-height:1.4;}'
      + '#course-sync-modal ul{margin:0 0 10px;padding-left:18px;}'
      + '#course-sync-modal li{margin:0 0 4px;line-height:1.35;}'
      + '#course-sync-modal label{display:block;margin:8px 0 4px;font-size:14px;font-weight:700;}'
      + '#course-sync-modal input{width:100%;box-sizing:border-box;border:1px solid #d9cfc6;border-radius:8px;padding:10px 12px;font-size:16px;}'
      + '#course-sync-modal input.course-sync-input-error{border-color:#d32f2f !important;box-shadow:0 0 0 1px #d32f2f;}'
      + '#course-sync-modal button{margin-top:12px;border:0;border-radius:999px;background:#7a3048;color:#fff;padding:10px 18px;font-size:16px;cursor:pointer;}'
      + '#course-sync-modal .course-sync-note{margin:0 0 8px;color:#d32f2f;font-weight:600;line-height:1.35;}'
      + '#course-sync-modal .course-sync-why{margin:0 0 6px;font-weight:700;}'
      + '#course-sync-modal .course-sync-footnote{margin:10px 0 0;font-size:13px;line-height:1.35;color:#5c514a;}'
      + '#course-sync-modal .course-sync-footnote strong{display:block;margin-top:8px;font-weight:600;}'
      + '#course-sync-modal.is-locked{cursor:default;}';
    document.head.appendChild(style);
    var modal = document.createElement('div');
    modal.id = 'course-sync-modal';
    modal.innerHTML = '<div class="course-sync-card"><h2></h2><p></p><div class="course-sync-body"></div><button type="button">Close</button><p class="course-sync-footnote" hidden></p></div>';
    modal.setAttribute('data-turbo-permanent', '');
    document.body.appendChild(modal);
    modal.addEventListener('click', function (event) {
      if (modal.classList.contains('is-locked')) event.stopPropagation();
    });
    document.addEventListener('keydown', function (event) {
      if (event.key === 'Escape' && modal.classList.contains('is-locked')) {
        event.preventDefault();
        event.stopPropagation();
      }
    }, true);
    return modal;
  }

  function showModal(title, message, names) {
    var modal = ensureModal();
    modal.querySelector('h2').textContent = title;
    modal.querySelector('p').textContent = message;
    var body = modal.querySelector('.course-sync-body');
    body.innerHTML = '';
    if (names && names.length) {
      var list = document.createElement('ul');
      names.forEach(function (name) {
        var item = document.createElement('li');
        item.textContent = name;
        list.appendChild(item);
      });
      body.appendChild(list);
    }
    var button = modal.querySelector('button');
    button.textContent = 'Close';
    button.onclick = function () {
      hideModal(modal);
    };
    var footnote = modal.querySelector('.course-sync-footnote');
    footnote.hidden = true;
    footnote.textContent = '';
    modal.classList.remove('is-locked');
    revealModal(modal);
    return body;
  }

  function revealModal(modal) {
    modal.setAttribute('data-turbo-permanent', '');
    modal.style.setProperty('display', 'flex', 'important');
    modal.style.setProperty('position', 'fixed', 'important');
    modal.style.setProperty('inset', '0', 'important');
    modal.style.setProperty('z-index', '2147483647', 'important');
    modal.style.setProperty('align-items', 'center', 'important');
    modal.style.setProperty('justify-content', 'center', 'important');
    modal.style.setProperty('background', 'rgba(28, 22, 18, 0.55)', 'important');
    modal.style.setProperty('padding', '16px', 'important');
    modal.style.setProperty('overflow', 'hidden', 'important');
    document.documentElement.style.setProperty('overflow', 'hidden', 'important');
    document.body.style.setProperty('overflow', 'hidden', 'important');
    modal.classList.add('is-open');
  }

  function hideModal(modal) {
    modal.style.setProperty('display', 'none', 'important');
    modal.classList.remove('is-open', 'is-locked');
    document.documentElement.style.removeProperty('overflow');
    document.body.style.removeProperty('overflow');
  }

  function showEmailModal() {
    var modal = ensureModal();
    if (modal.classList.contains('is-locked') && modal.classList.contains('is-open')) return;
    modal.classList.add('is-locked');
    revealModal(modal);
    modal.querySelector('h2').textContent = 'Save Your Course Progress';
    modal.querySelector('p').textContent = 'Enter the email address you use to access this course so we can securely link your learning account.';
    var body = modal.querySelector('.course-sync-body');
    body.innerHTML = ''
      + '<p class="course-sync-why">Why is this important?</p>'
      + '<ul>'
      + '<li><strong>Save Your Progress:</strong> Keep your course progress linked to your email address.</li>'
      + '<li><strong>Sync With Your Partner:</strong> Connect your account with your partner\'s account so both learning journeys stay synchronized.</li>'
      + '<li><strong>Unlock Course Weeks Together:</strong> Course content will automatically become available as you and your partner complete the required lessons.</li>'
      + '</ul>'
      + '<p class="course-sync-note" hidden></p>'
      + '<label for="course-sync-email">Email Address</label>'
      + '<input id="course-sync-email" type="email" autocomplete="email" placeholder="Enter your registered email address">';
    var footnote = modal.querySelector('.course-sync-footnote');
    footnote.hidden = false;
    footnote.innerHTML = 'You\'ll only need to do this once. Please use the same email address you use for your course account.'
      + '<strong>Use the email address associated with your Kajabi course account. Using a different email may prevent your progress from syncing correctly.</strong>';
    var note = body.querySelector('.course-sync-note');
    var input = body.querySelector('#course-sync-email');
    var button = modal.querySelector('button');
    function showEmailError(message) {
      note.hidden = false;
      note.textContent = message;
      input.classList.add('course-sync-input-error');
    }
    input.addEventListener('input', function () {
      input.classList.remove('course-sync-input-error');
      note.hidden = true;
    });
    button.textContent = 'Continue';
    button.disabled = false;
    button.onclick = function () {
      var email = input.value.trim();
      if (!email) {
        showEmailError('Enter your registered email address.');
        return;
      }
      button.disabled = true;
      input.classList.remove('course-sync-input-error');
      note.hidden = true;
      CourseApi.bindAccount({ email: email, kajabiUserId: kajabiUserId }).then(function (result) {
        markIdentity(result, kajabiUserId);
        hideModal(modal);
        handleKnownUser();
      }).catch(function (error) {
        button.disabled = false;
        if (error.status === 404) {
          showEmailError('We could not find that email. Enter the same email you use to log in.');
        } else if (error.status === 409) {
          showEmailError('That email is already connected to a login. Enter the email for this sign-in.');
        } else {
          showEmailError(error.message);
        }
      });
    };
  }

  function inviteFields(form) {
    var nameInput = form.querySelector('#form_submission_name, input[name="form_submission[name]"]');
    var emailInput = form.querySelector('#form_submission_email, input[name="form_submission[email]"]');
    var permission = form.querySelector('input[type="checkbox"][name="form_submission[custom_1]"]');
    return {
      name: nameInput && nameInput.value ? nameInput.value.trim() : '',
      email: emailInput && emailInput.value ? emailInput.value.trim() : '',
      allowed: !permission || permission.checked,
    };
  }

  function linkSavedPurchaser(partnerName, partnerEmail) {
    var purchaser = savedPurchaser();
    if (!purchaser || !purchaser.email) {
      return Promise.reject(new Error('Your checkout details were not saved in this browser. Finish checkout on this device, then send the invite.'));
    }
    var ready = purchaser.id
      ? Promise.resolve(purchaser)
      : CourseApi.registerPurchaser({ name: purchaser.name, email: purchaser.email }).then(savePurchaser);
    return ready.then(function (record) {
      return CourseApi.linkPartner({
        partnerName: partnerName,
        partnerEmail: partnerEmail,
        purchaserUserId: record.id,
        purchaserEmail: record.email,
        token: record.token,
      });
    });
  }

  function watchPartnerInvite() {
    var emailInput = document.querySelector('#form_submission_email, input[name="form_submission[email]"]');
    var form = emailInput && emailInput.form;
    if (!form) {
      showPartnerModal();
      return;
    }
    form.addEventListener('submit', function (event) {
      if (form.getAttribute('data-course-sync-linked') === 'true') return;
      var fields = inviteFields(form);
      if (!fields.name || !fields.email || !fields.allowed) return;
      event.preventDefault();
      event.stopPropagation();
      var button = form.querySelector('#form-button, button[type="submit"]');
      if (button) button.disabled = true;
      linkSavedPurchaser(fields.name, fields.email).then(function () {
        form.setAttribute('data-course-sync-linked', 'true');
        if (button) button.disabled = false;
        HTMLFormElement.prototype.submit.call(form);
      }).catch(function (error) {
        if (button) button.disabled = false;
        showModal('Could not link your partner', error.message);
      });
    }, true);
  }

  function showPartnerModal() {
    var purchaser = savedPurchaser();
    if (!purchaser || !purchaser.email) {
      showModal('Complete checkout first', 'Your name and email were not saved from checkout in this browser. Finish checkout on this device, then add your partner.');
      return;
    }
    var body = showModal('Add your partner', 'Enter your partner’s name and email. Their progress stays linked to your purchase.');
    body.innerHTML = ''
      + '<label for="course-sync-partner-name">Partner name</label><input id="course-sync-partner-name">'
      + '<label for="course-sync-partner-email">Partner email</label><input id="course-sync-partner-email" type="email">'
      + '<p class="course-sync-note" hidden></p>';
    var button = document.querySelector('#course-sync-modal button');
    button.textContent = 'Link partner';
    button.onclick = function () {
      var note = body.querySelector('.course-sync-note');
      var partnerName = body.querySelector('#course-sync-partner-name').value.trim();
      var partnerEmail = body.querySelector('#course-sync-partner-email').value.trim();
      if (!partnerName || !partnerEmail) {
        note.hidden = false;
        note.textContent = 'Enter your partner’s name and email.';
        return;
      }
      button.disabled = true;
      var ready = purchaser.id
        ? Promise.resolve(purchaser)
        : CourseApi.registerPurchaser({ name: purchaser.name, email: purchaser.email }).then(function (created) {
          purchaser = created;
          return savePurchaser(created);
        });
      ready.then(function (record) {
        return CourseApi.linkPartner({
          partnerName: partnerName,
          partnerEmail: partnerEmail,
          purchaserUserId: record.id,
          purchaserEmail: record.email,
          token: record.token,
        });
      }).then(function () {
        button.disabled = false;
        showModal('Partner linked', 'Your partner can sign in with ' + partnerEmail + '. Their lessons will sync with yours.');
        document.querySelector('#course-sync-modal button').textContent = 'Close';
      }).catch(function (error) {
        button.disabled = false;
        note.hidden = false;
        note.textContent = error.message;
      });
    };
  }

  function markIdentity(result, id) {
    var record = savePurchaser(result);
    accountUserId = record.id ? String(record.id) : '';
    if (id) kajabiUserId = id;
    identityReady = true;
    if (kajabiUserId) localStorage.setItem('courseSync.linkedId', kajabiUserId);
  }

  function visibleChapters(override) {
    var lessons = moduleLessons(playlistRoot());
    var chapters = [];
    for (var index = 0; index < lessons.length; index += 1) {
      var lesson = lessons[index];
      if (!lesson.title || lesson.weekNumber < 1 || lesson.weekNumber > 8) continue;
      var completed = lesson.completed;
      if (override && lesson.chapterId === override.chapterId) completed = override.completed;
      chapters.push({
        chapterName: lesson.title,
        weekNumber: lesson.weekNumber,
        chapterId: lesson.chapterId,
        completed: completed,
      });
    }
    if (override && override.chapterId && !chapters.some(function (chapter) { return chapter.chapterId === override.chapterId; })) {
      var current = readLesson();
      if (current.title && current.weekNumber >= 1 && current.weekNumber <= 8) {
        chapters.push({
          chapterName: current.title,
          weekNumber: current.weekNumber,
          chapterId: current.chapterId,
          completed: override.completed,
        });
      }
    }
    return chapters.filter(function (chapter) { return chapter.chapterName && chapter.chapterId; });
  }

  function progressBody(chapters) {
    var body = { chapters: chapters };
    if (accountUserId) body.userId = Number(accountUserId);
    if (kajabiUserId) body.kajabiUserId = kajabiUserId;
    return body;
  }

  function syncVisibleProgress(override, announce) {
    if (!identityReady) {
      pendingCompletion = override || pendingCompletion;
      return Promise.resolve(null);
    }
    var chapters = visibleChapters(override);
    if (!chapters.length) return Promise.resolve(null);
    return CourseApi.updateChapterProgress(progressBody(chapters)).then(function (result) {
      if (!announce) return result;
      var updates = result.data && result.data.updates ? result.data.updates : [];
      var update = updates[updates.length - 1];
      if (!update || !update.user || !update.user.completed) return result;
      return CourseApi.getCourse(kajabiUserId).then(function (course) {
        var week = findWeek(course.partner, update.weekNumber);
        var label = otherRole(course);
        var waiting = !(update.partner && update.partner.completed);
        showModal(
          waiting ? 'Wait for your ' + label + ' to complete' : 'You both finished this week',
          update.partnership && update.partnership.message
            ? update.partnership.message
            : (waiting
              ? 'Your ' + label + ' still has lessons left in this week.'
              : 'Your ' + label + ' has finished this week too.'),
          chapterLines(week),
        );
        return result;
      });
    });
  }

  function handleKnownUser() {
    if (!isLessonPage()) return;
    watchLesson();
    var override = pendingCompletion;
    pendingCompletion = null;
    syncVisibleProgress(override, Boolean(override)).catch(function (error) {
      if (override && !isMissingIdentity(error)) showModal('Progress was not saved', error.message);
    });
  }

  function handleMissingUser() {
    identityReady = false;
    localStorage.removeItem('courseSync.linkedId');
    showEmailModal();
  }

  var lessonWatchBound = false;

  function watchLesson() {
    if (lessonWatchBound) return;
    lessonWatchBound = true;
    document.addEventListener('click', function (event) {
      var node = event.target && event.target.nodeType === 1 ? event.target : event.target.parentElement;
      if (!node || !node.closest) return;
      var complete = node.closest('.btn--completion, .mark-as-complete a');
      if (complete) {
        saveCurrentLesson(complete);
        return;
      }
      var control = node.closest('a.track--more, a');
      if (!control) return;
      var isNextModule = control.classList.contains('track--more') || Boolean(control.querySelector('.track__more'));
      if (!isNextModule) {
        var label = control.textContent.replace(/\s+/g, ' ').trim().toLowerCase();
        isNextModule = label === 'next module';
      }
      if (isNextModule) blockNextModule(event, control);
    }, true);
  }

  function saveCurrentLesson(control) {
    var lesson = readLesson();
    if (!lesson.title || lesson.weekNumber < 1 || lesson.weekNumber > 8) {
      showModal('Progress was not saved', 'This lesson could not be matched to one of the 8 course weeks.');
      return;
    }
    var completed = !control || control.getAttribute('data-post-completion-toggle') !== 'true';
    syncVisibleProgress({ chapterId: lesson.chapterId, completed: completed }, true).catch(function (error) {
      if (!isMissingIdentity(error)) showModal('Progress was not saved', error.message);
    });
  }

  function progressLines(person) {
    if (!person || !person.chapters || !person.chapters.length) return [];
    return person.chapters.map(function (chapter) {
      return chapter.chapterName + (chapter.completed ? ' — done' : ' — not done');
    });
  }

  function progressSentence(person, label) {
    if (!person) return 'Your ' + label + ' has not started this week.';
    var done = Number(person.completedChapters || 0);
    var total = Number(person.totalChapters || 0);
    if (!total) return 'Your ' + label + ' has no saved lessons for this week yet.';
    return 'Your ' + label + ' has finished ' + done + ' of ' + total + ' lessons in this week.';
  }

  function blockNextModule(event, control) {
    event.preventDefault();
    event.stopPropagation();
    var playlist = playlistRoot(control);
    var weekNumber = weekNumberFromPlaylist(playlist);
    var moduleName = playlistTitle(playlist) || ('Week ' + weekNumber);
    if (weekNumber < 1 || weekNumber > 8) {
      showModal('Could not read this module', 'Each visible playlist needs to be one of the 8 course weeks before the next module can open.');
      return;
    }
    var lessons = moduleLessons(playlist);
    var missing = lessons.filter(function (lesson) { return lesson.title && !lesson.completed; });
    if (!lessons.length || missing.length) {
      showModal(
        'Complete this module first',
        'Mark all ' + lessons.length + ' visible lessons in ' + moduleName + ' complete before the next module can open.',
        missing.map(function (lesson) { return lesson.title; }),
      );
      return;
    }
    if (!identityReady) {
      showEmailModal();
      return;
    }
    CourseApi.updateChapterProgress(progressBody(lessons.map(function (lesson) {
      return {
        chapterName: lesson.title,
        weekNumber: weekNumber,
        chapterId: lesson.chapterId,
        completed: true,
      };
    }))).then(function (result) {
      var updates = result.data && result.data.updates ? result.data.updates : [];
      var update = updates[updates.length - 1];
      if (!update) {
        showModal('Could not check your partner', 'Week status did not come back.');
        return;
      }
      var label = update.otherRole || 'partner';
      var partnerDone = update.partner && update.partner.completed;
      var bothDone = update.partnership && update.partnership.weekCompleted;
      if (!partnerDone || !bothDone) {
        showModal(
          'Wait for your ' + label + ' to complete',
          moduleName + '. '
            + (update.partnership && update.partnership.message ? update.partnership.message + ' ' : '')
            + progressSentence(update.partner, label),
          progressLines(update.partner),
        );
        return;
      }
      if (control.href) window.location.href = control.href;
    }).catch(function (error) {
      showModal('Could not open the next module', error.message);
    });
  }

  function lookupKnownIdentity(ids, index) {
    if (index >= ids.length) {
      kajabiUserId = readCookie('rl_user_id') || siteMemberId();
      handleMissingUser();
      return;
    }
    CourseApi.lookup(ids[index]).then(function (result) {
      markIdentity(result, ids[index]);
      handleKnownUser();
    }).catch(function (error) {
      if (isMissingIdentity(error)) {
        lookupKnownIdentity(ids, index + 1);
        return;
      }
      showModal('Could not check your account', error.message);
    });
  }

  function boot() {
    if (isCheckoutPage()) {
      watchCheckout();
      return;
    }
    var ids = identityCandidates();
    kajabiUserId = ids[0] || '';
    if (isThankYouPage()) {
      watchPartnerInvite();
      return;
    }
    if (isLessonPage()) watchLesson();
    if (!ids.length) return;
    lookupKnownIdentity(ids, 0);
  }

  var api = {
    registerPurchaser: function (input, extra) {
      return request('/api/v1/users/register', {
        method: 'POST',
        admin: true,
        keepalive: extra && extra.keepalive,
        body: compact({ name: input.name, email: input.email }),
      });
    },
    lookup: function (id) {
      return request('/api/v1/users/lookup?kajabiUserId=' + encodeURIComponent(id), {
        admin: true,
      });
    },
    bindAccount: function (input) {
      return request('/api/v1/users/bind', {
        method: 'POST',
        admin: true,
        body: compact(input),
      });
    },
    linkPartner: function (input) {
      return request('/api/v1/partners/link', {
        method: 'POST',
        admin: !input.token,
        token: input.token,
        body: compact({
          partnerName: input.partnerName,
          partnerEmail: input.partnerEmail,
          purchaserUserId: input.purchaserUserId,
          purchaserEmail: input.purchaserEmail,
        }),
      });
    },
    getCourse: function (id) {
      return request('/api/v1/course/sync?kajabiUserId=' + encodeURIComponent(id));
    },
    updateChapterProgress: function (input) {
      return request('/api/v1/chapters/progress', {
        method: 'POST',
        keepalive: true,
        body: input,
      });
    },
  };

  document.addEventListener('turbo:load', boot);
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();

  return api;
})();
