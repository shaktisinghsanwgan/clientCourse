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
      + '#course-sync-modal button{margin-top:16px;border:0;border-radius:999px;background:#7a3048;color:#fff;padding:12px 18px;font-size:16px;cursor:pointer;}';
    document.head.appendChild(style);
    var modal = document.createElement('div');
    modal.id = 'course-sync-modal';
    modal.innerHTML = '<div class="course-sync-card"><h2></h2><p></p><div class="course-sync-body"></div><button type="button">Close</button></div>';
    document.body.appendChild(modal);
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
    modal.classList.add('is-open');
    return body;
  }

  function showProfileModal() {
    var member = memberFromPage();
    var body = showModal(
      'Confirm your account',
      'We could not match this login yet. Check your name and email, then save. Next time we will recognize you and keep your progress.',
    );
    body.innerHTML = ''
      + '<label for="course-sync-name">Full Name</label><input id="course-sync-name">'
      + '<label for="course-sync-email">E-mail</label><input id="course-sync-email" type="email">';
    body.querySelector('#course-sync-name').value = member.name;
    body.querySelector('#course-sync-email').value = member.email;
    var button = document.querySelector('#course-sync-modal button');
    button.textContent = 'Save';
    button.onclick = function () {
      var name = body.querySelector('#course-sync-name').value.trim() || fieldValue('#member_name');
      var email = body.querySelector('#course-sync-email').value.trim() || fieldValue('#member_email');
      if (!name || !email) {
        showModal('Name and email are required', 'Fill Full Name and E-mail on this page, then save again.');
        return;
      }
      if (!kajabiUserId) {
        showModal('Login was not found', 'The rl_user_id cookie is missing, so this browser cannot be linked yet.');
        return;
      }
      CourseApi.bindAccount({ name: name, email: email, kajabiUserId: kajabiUserId }).then(function (result) {
        savePurchaser(result);
        sessionStorage.removeItem(PROFILE_FLAG);
        showModal('You are saved', 'This login is now linked. You can go back to the course.');
        document.querySelector('#course-sync-modal button').textContent = 'Close';
        document.querySelector('#course-sync-modal button').onclick = function () {
          document.getElementById('course-sync-modal').classList.remove('is-open');
        };
      }).catch(function (error) {
        showModal('Could not save your account', error.message);
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
    sessionStorage.setItem(PROFILE_FLAG, '1');
    if (isSettingsPage()) {
      showProfileModal();
      return;
    }
    window.location.href = '/settings/account';
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
      if (!update || !update.user || !update.user.completed || (update.partner && update.partner.completed)) return;
      return CourseApi.getCourse(kajabiUserId).then(function (course) {
        var week = findWeek(course.partner, update.weekNumber);
        showModal(
          'Wait for your partner to complete',
          update.partnership && update.partnership.message
            ? update.partnership.message
            : 'Your partner still has lessons left in this week.',
          incompleteNames(week),
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
      var week = findWeek(course.user, lesson.weekNumber);
      if (week && week.completed && control.href) {
        window.location.href = control.href;
        return;
      }
      showModal(
        'Complete your module first',
        'Finish every lesson in this week before you open the next module.',
        incompleteNames(week),
      );
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
      sessionStorage.removeItem(PROFILE_FLAG);
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
