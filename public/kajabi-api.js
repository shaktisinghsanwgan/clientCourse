var CourseApi = (function () {
  var BASE_URL = 'https://web-production-b4f12.up.railway.app';
  var ADMIN_API_KEY = 'local-dev-admin-key';
  var STORAGE_KEY = 'courseSync.purchaser';
  var PROFILE_FLAG = 'courseSync.needProfile';
  var kajabiUserId = '';

  function request(path, options) {
    var settings = options || {};
    var headers = {};
    if (settings.body !== undefined) headers['Content-Type'] = 'application/json';
    if (settings.admin) headers['X-Api-Key'] = ADMIN_API_KEY;
    if (settings.token) headers.Authorization = 'Bearer ' + settings.token;

    return fetch(BASE_URL + path, {
      method: settings.method || 'GET',
      headers: headers,
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
    return /thank[-_ ]?you/i.test(window.location.pathname + window.location.search + document.title);
  }

  function isLessonPage() {
    return /\/posts\/\d+/.test(window.location.pathname) || Boolean(document.querySelector('.mark-as-complete, .btn--completion'));
  }

  function readLesson() {
    var heading = document.querySelector('h1');
    var title = heading ? heading.textContent.replace(/\s+/g, ' ').trim() : '';
    var weekNumber = 1;
    var source = heading && heading.nextElementSibling ? heading.nextElementSibling.textContent : document.body.innerText;
    var weekMatch = String(source || '').match(/Week\s+(\d+)/i);
    if (weekMatch) weekNumber = Number(weekMatch[1]);
    var postMatch = window.location.pathname.match(/posts\/(\d+)/);
    return {
      title: title,
      weekNumber: weekNumber,
      chapterId: postMatch ? postMatch[1] : '',
    };
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
      + '#course-sync-modal{position:fixed;inset:0;z-index:99999;display:none;align-items:center;justify-content:center;background:rgba(28,22,18,.55);padding:24px;}'
      + '#course-sync-modal.is-open{display:flex;}'
      + '#course-sync-modal .course-sync-card{width:min(480px,100%);background:#fffaf6;color:#2b211c;border-radius:16px;padding:28px;box-shadow:0 20px 50px rgba(0,0,0,.2);font-family:Georgia,serif;}'
      + '#course-sync-modal h2{margin:0 0 8px;font-size:28px;}'
      + '#course-sync-modal p{margin:0 0 16px;line-height:1.45;}'
      + '#course-sync-modal ul{margin:0 0 16px;padding-left:18px;}'
      + '#course-sync-modal label{display:block;margin:12px 0 6px;font-size:14px;}'
      + '#course-sync-modal input{width:100%;box-sizing:border-box;border:1px solid #d9cfc6;border-radius:8px;padding:12px;font-size:16px;}'
      + '#course-sync-modal button{margin-top:16px;border:0;border-radius:999px;background:#7a3048;color:#fff;padding:12px 18px;font-size:16px;cursor:pointer;}'
      + '#course-sync-modal .course-sync-note{margin:0 0 12px;color:#7a3048;line-height:1.4;}'
      + '#course-sync-modal.is-locked{cursor:default;}';
    document.head.appendChild(style);
    var modal = document.createElement('div');
    modal.id = 'course-sync-modal';
    modal.innerHTML = '<div class="course-sync-card"><h2></h2><p></p><div class="course-sync-body"></div><button type="button">Close</button></div>';
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
      modal.classList.remove('is-open');
    };
    modal.classList.remove('is-locked');
    modal.classList.add('is-open');
    return body;
  }

  function showEmailModal() {
    var modal = ensureModal();
    if (modal.classList.contains('is-locked')) return;
    modal.classList.add('is-open', 'is-locked');
    modal.querySelector('h2').textContent = 'Save your progress on this login';
    modal.querySelector('p').textContent = 'Enter the email you use to sign in. Your lessons stay on that account, and you only do this once.';
    var body = modal.querySelector('.course-sync-body');
    body.innerHTML = '<p class="course-sync-note" hidden></p><label for="course-sync-email">Email</label><input id="course-sync-email" type="email" autocomplete="email">';
    var note = body.querySelector('.course-sync-note');
    var input = body.querySelector('#course-sync-email');
    var button = modal.querySelector('button');
    button.textContent = 'Continue';
    button.disabled = false;
    button.onclick = function () {
      var email = input.value.trim();
      if (!email) {
        note.hidden = false;
        note.textContent = 'Enter the email you use to sign in.';
        return;
      }
      button.disabled = true;
      CourseApi.bindAccount({ email: email, kajabiUserId: kajabiUserId }).then(function (result) {
        savePurchaser(result);
        localStorage.setItem('courseSync.linkedId', kajabiUserId);
        modal.classList.remove('is-open', 'is-locked');
        handleKnownUser();
      }).catch(function (error) {
        button.disabled = false;
        note.hidden = false;
        if (error.status === 404) {
          note.textContent = 'We could not find that email. Enter the same email you use to log in.';
        } else if (error.status === 409) {
          note.textContent = 'That email is already connected to a login. Enter the email for this sign-in.';
        } else {
          note.textContent = error.message;
        }
      });
    };
  }

  function showPartnerModal() {
    var purchaser = savedPurchaser();
    var body = showModal('Add your partner', 'Enter your partner’s name and email. Their progress stays linked to your purchase.');
    var html = '';
    if (!purchaser) {
      html += '<label for="course-sync-your-name">Your name</label><input id="course-sync-your-name">';
      html += '<label for="course-sync-your-email">Your email</label><input id="course-sync-your-email" type="email">';
    }
    html += '<label for="course-sync-partner-name">Partner name</label><input id="course-sync-partner-name">';
    html += '<label for="course-sync-partner-email">Partner email</label><input id="course-sync-partner-email" type="email">';
    body.innerHTML = html;
    var button = document.querySelector('#course-sync-modal button');
    button.textContent = 'Link partner';
    button.onclick = function () {
      var partnerName = body.querySelector('#course-sync-partner-name').value.trim();
      var partnerEmail = body.querySelector('#course-sync-partner-email').value.trim();
      var current = savedPurchaser();
      var ready = Promise.resolve(current);
      if (!current) {
        var name = body.querySelector('#course-sync-your-name').value.trim();
        var email = body.querySelector('#course-sync-your-email').value.trim();
        ready = CourseApi.registerPurchaser({ name: name, email: email }).then(savePurchaser);
      }
      ready.then(function (record) {
        return CourseApi.linkPartner({
          partnerName: partnerName,
          partnerEmail: partnerEmail,
          purchaserUserId: record.id,
          token: record.token,
        });
      }).then(function () {
        showModal('Partner linked', 'Your partner can sign in with that email. Their lessons will sync with yours.');
        document.querySelector('#course-sync-modal button').textContent = 'Close';
      }).catch(function (error) {
        showModal('Could not link your partner', error.message);
      });
    };
  }

  function handleKnownUser() {
    if (isLessonPage()) watchLesson();
  }

  function handleMissingUser() {
    if (localStorage.getItem('courseSync.linkedId') === kajabiUserId) return;
    showEmailModal();
  }

  function watchLesson() {
    document.addEventListener('click', function (event) {
      var node = event.target && event.target.nodeType === 1 ? event.target : event.target.parentElement;
      if (!node || !node.closest) return;
      var complete = node.closest('.btn--completion, .mark-as-complete a');
      if (complete) {
        saveCurrentLesson();
        return;
      }
      var control = node.closest('a, button');
      if (!control) return;
      var label = control.textContent.replace(/\s+/g, ' ').trim().toLowerCase();
      if (label === 'next module') blockNextModule(event, control);
    }, true);
  }

  function saveCurrentLesson() {
    var lesson = readLesson();
    if (!lesson.title || !kajabiUserId) return;
    CourseApi.updateChapterProgress({
      kajabiUserId: kajabiUserId,
      chapters: [{
        chapterName: lesson.title,
        weekNumber: lesson.weekNumber,
        chapterId: lesson.chapterId,
        completed: true,
      }],
    }).then(function (result) {
      var update = result.data && result.data.updates ? result.data.updates[result.data.updates.length - 1] : null;
      if (!update || !update.user || !update.user.completed) return;
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
      });
    }).catch(function (error) {
      showModal('Progress was not saved', error.message);
    });
  }

  function blockNextModule(event, control) {
    event.preventDefault();
    event.stopPropagation();
    var lesson = readLesson();
    CourseApi.getCourse(kajabiUserId).then(function (course) {
      var mine = findWeek(course.user, lesson.weekNumber);
      var theirs = findWeek(course.partner, lesson.weekNumber);
      var label = otherRole(course);
      if (!mine || !mine.completed) {
        showModal(
          'Complete your module first',
          'Finish every lesson in this week before you open the next module.',
          incompleteNames(mine),
        );
        return;
      }
      if (!course.synchronization || !course.synchronization.partnershipActive || !theirs || !theirs.completed) {
        showModal(
          'Wait for your ' + label + ' to complete',
          'Your ' + label + ' still has lessons left in this week.',
          chapterLines(theirs),
        );
        return;
      }
      if (control.href) window.location.href = control.href;
    }).catch(function (error) {
      showModal('Could not check this module', error.message);
    });
  }

  function boot() {
    kajabiUserId = readCookie('rl_user_id');
    if (isThankYouPage()) {
      showPartnerModal();
      return;
    }
    if (!kajabiUserId) return;
    CourseApi.lookup(kajabiUserId).then(function (result) {
      savePurchaser(result);
      localStorage.setItem('courseSync.linkedId', kajabiUserId);
      handleKnownUser();
    }).catch(function (error) {
      if (error.status === 404) {
        handleMissingUser();
        return;
      }
      if (isLessonPage()) showModal('Could not check your account', error.message);
    });
  }

  var api = {
    registerPurchaser: function (input) {
      return request('/api/v1/users/register', {
        method: 'POST',
        admin: true,
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
        body: input,
      });
    },
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();

  return api;
})();
