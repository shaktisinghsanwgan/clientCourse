(function () {
  var BASE_URL = 'https://web-production-b4f12.up.railway.app';
  var ADMIN_API_KEY = 'local-dev-admin-key';
  var STORAGE_KEY = 'courseSync.purchaser';
  var EMAIL_KEY = 'courseSync.purchaserEmail';
  var PAGES = {
    one_time: 'https://www.reignitesex.com/invite-your-partner-one-time-payment',
    eight_month: 'https://www.reignitesex.com/invite-your-partner-8-monthly-payments',
  };
  var formBound = false;

  function readPurchaser() {
    var record = null;
    try {
      record = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
    } catch (error) {
      record = null;
    }
    var direct = '';
    try {
      direct = String(localStorage.getItem(EMAIL_KEY) || '').trim().toLowerCase();
    } catch (error) {
      direct = '';
    }
    if (!record && !direct) return null;
    record = record || {};
    if (!record.email && direct) record.email = direct;
    return record;
  }

  function writePurchaser(record) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(record));
    return record;
  }

  function pagePlan() {
    var path = window.location.pathname;
    if (/invite-your-partner-one-time-payment/i.test(path)) return 'one_time';
    if (/invite-your-partner-8-monthly-payments/i.test(path)) return 'eight_month';
    return '';
  }

  function isInvitePage() {
    return Boolean(pagePlan()) || /thank[-_ ]?you/i.test(window.location.pathname);
  }

  function redirectIfNeeded() {
    var saved = readPurchaser();
    var plan = saved && PAGES[saved.plan] ? saved.plan : pagePlan();
    if (!plan || !PAGES[plan]) return false;
    var target = new URL(PAGES[plan]);
    if (window.location.pathname === target.pathname) return false;
    window.location.replace(target.href);
    return true;
  }

  function purchaserEmailField() {
    var field = document.querySelector('#form_submission_custom_4, #form_submission_custom_3, input[name="form_submission[custom_4]"], input[name="form_submission[custom_3]"]');
    if (field) return field;
    var inputs = document.querySelectorAll('input[type="email"]');
    for (var index = 0; index < inputs.length; index += 1) {
      var placeholder = (inputs[index].getAttribute('placeholder') || '').trim().toLowerCase();
      if (placeholder === 'email') return inputs[index];
    }
    return null;
  }

  function lockPurchaserEmail() {
    var saved = readPurchaser();
    var field = purchaserEmailField();
    if (!field || !saved || !saved.email) return;
    if (field.value !== saved.email) {
      field.value = saved.email;
      field.dispatchEvent(new Event('input', { bubbles: true }));
      field.dispatchEvent(new Event('change', { bubbles: true }));
    }
    field.readOnly = true;
    field.setAttribute('readonly', 'readonly');
    field.setAttribute('aria-readonly', 'true');
    field.style.background = '#f4f1ee';
  }

  function fillPurchaserEmail() {
    lockPurchaserEmail();
    var field = purchaserEmailField();
    if (field && field.value && field.value.indexOf('@') > 0) return;
    var id = readCookie('rl_user_id');
    if (!id) return;
    request('/api/v1/users/lookup?kajabiUserId=' + encodeURIComponent(id)).then(function (result) {
      var data = (result && result.data) || {};
      var email = String(data.email || '').trim().toLowerCase();
      if (email.indexOf('@') < 1) return;
      var saved = readPurchaser() || {};
      saved.email = email;
      saved.name = saved.name || data.name || '';
      saved.kajabiUserId = id;
      if (data.userId) saved.id = data.userId;
      writePurchaser(saved);
      lockPurchaserEmail();
    }).catch(function () {});
  }

  function request(path, options) {
    var settings = options || {};
    var headers = { 'Content-Type': 'application/json' };
    if (settings.admin) headers['X-Api-Key'] = ADMIN_API_KEY;
    if (settings.token) headers.Authorization = 'Bearer ' + settings.token;
    return fetch(BASE_URL + path, {
      method: settings.method || 'GET',
      headers: headers,
      body: JSON.stringify(settings.body || {}),
    }).then(function (response) {
      return response.text().then(function (text) {
        var data = text ? JSON.parse(text) : null;
        if (!response.ok) {
          var error = new Error((data && data.message) || ('Request failed (' + response.status + ')'));
          error.status = response.status;
          throw error;
        }
        return data;
      });
    });
  }

  function saveRegistered(result, purchaser) {
    var data = (result && result.data) || result || {};
    var user = data.user || {};
    return writePurchaser({
      id: user.id || data.userId || purchaser.id,
      name: user.name || purchaser.name || '',
      email: user.email || purchaser.email || '',
      token: data.token || purchaser.token || '',
      role: user.role || purchaser.role || '',
      kajabiUserId: user.kajabiUserId || purchaser.kajabiUserId || '',
      plan: purchaser.plan || '',
      offerId: purchaser.offerId || '',
      thankYou: purchaser.thankYou || '',
    });
  }

  function registerPurchaser(purchaser) {
    var body = {
      name: purchaser.name,
      email: purchaser.email,
    };
    if (purchaser.plan) body.offerReference = purchaser.plan;
    return request('/api/v1/users/register', {
      method: 'POST',
      admin: true,
      body: body,
    }).then(function (result) {
      return saveRegistered(result, purchaser);
    });
  }

  function purchaserEmailOnPage() {
    var field = purchaserEmailField();
    var email = field && field.value ? field.value.trim().toLowerCase() : '';
    return email.indexOf('@') > 0 ? email : '';
  }

  function linkByPurchaserEmail(email, fields) {
    return request('/api/v1/partners/link', {
      method: 'POST',
      admin: true,
      body: {
        purchaserEmail: email,
        partnerName: fields.name,
        partnerEmail: fields.email,
      },
    });
  }

  function linkSavedPurchaser(fields) {
    var purchaser = readPurchaser() || {};
    var email = purchaser.email || purchaserEmailOnPage();
    var name = purchaser.name || 'Purchaser';
    if (!email) {
      return Promise.reject(new Error('Your checkout details were not saved in this browser. Finish checkout on this device, then send the invite.'));
    }
    return linkByPurchaserEmail(email, fields).catch(function (error) {
      if (error.status !== 404) throw error;
      return registerPurchaser({
        name: name,
        email: email,
        plan: purchaser.plan || pagePlan(),
      }).then(function (record) {
        return linkPartner(record, fields.name, fields.email);
      });
    });
  }

  function savePartner(fields) {
    return linkSavedPurchaser(fields);
  }

  function linkPartner(purchaser, partnerName, partnerEmail) {
    return request('/api/v1/partners/link', {
      method: 'POST',
      admin: !purchaser.token,
      token: purchaser.token,
      body: {
        partnerName: partnerName,
        partnerEmail: partnerEmail,
        purchaserUserId: purchaser.id,
        purchaserEmail: purchaser.email,
      },
    });
  }

  function inviteFields(form) {
    var nameInput = form.querySelector('#form_submission_name, input[name="form_submission[name]"], input[name*="[name]"]');
    var emailInput = form.querySelector('#form_submission_email, input[name="form_submission[email]"]');
    if (!emailInput) {
      var emails = form.querySelectorAll('input[type="email"]');
      for (var index = 0; index < emails.length; index += 1) {
        var fieldName = emails[index].name || emails[index].id || '';
        if (/custom_3|custom_4/.test(fieldName) || emails[index].readOnly) continue;
        emailInput = emails[index];
        break;
      }
    }
    var permission = form.querySelector('input[type="checkbox"][name="form_submission[custom_1]"]');
    return {
      name: nameInput && nameInput.value ? nameInput.value.trim() : '',
      email: emailInput && emailInput.value ? emailInput.value.trim() : '',
      allowed: !permission || permission.checked,
    };
  }

  function showFormError(form, message) {
    var note = form.querySelector('.course-sync-form-error');
    if (!note) {
      note = document.createElement('p');
      note.className = 'course-sync-form-error';
      note.style.color = '#b42318';
      note.style.margin = '8px 0 0';
      var button = form.querySelector('#form-button, button[type="submit"]');
      if (button && button.parentNode) button.parentNode.insertBefore(note, button);
      else form.appendChild(note);
    }
    note.textContent = message;
  }

  function watchForm() {
    var partnerEmail = document.querySelector('#form_submission_email, input[name="form_submission[email]"]');
    var form = partnerEmail && partnerEmail.form;
    if (!form) {
      var forms = document.querySelectorAll('form');
      for (var index = 0; index < forms.length; index += 1) {
        if (forms[index].querySelector('input[type="email"], input[name*="email"]')) {
          form = forms[index];
          break;
        }
      }
    }
    if (!form || form.getAttribute('data-course-sync-bound') === 'true') return;
    form.setAttribute('data-course-sync-bound', 'true');
    formBound = true;
    form.addEventListener('submit', function (event) {
      if (form.getAttribute('data-course-sync-linked') === 'true') return;
      var fields = inviteFields(form);
      if (!fields.allowed || !fields.name || !fields.email) return;
      event.preventDefault();
      event.stopPropagation();
      var button = form.querySelector('#form-button, button[type="submit"]');
      if (button) button.disabled = true;
      var finish = function () {
        form.setAttribute('data-course-sync-linked', 'true');
        if (button) button.disabled = false;
        HTMLFormElement.prototype.submit.call(form);
      };
      savePartner(fields).then(finish).catch(finish);
    }, true);
  }

  function readCookie(name) {
    var pieces = document.cookie ? document.cookie.split(';') : [];
    for (var index = 0; index < pieces.length; index += 1) {
      var piece = pieces[index].trim();
      if (piece.indexOf(name + '=') === 0) return decodeURIComponent(piece.slice(name.length + 1));
    }
    return '';
  }

  function purchaserEmail() {
    var saved = readPurchaser();
    if (saved && saved.email) return String(saved.email).trim().toLowerCase();
    try {
      var stored = String(localStorage.getItem(EMAIL_KEY) || '').trim().toLowerCase();
      if (stored.indexOf('@') > 0) return stored;
    } catch (error) {
      /* storage can be blocked */
    }
    var field = purchaserEmailField();
    var typed = field && field.value ? field.value.trim().toLowerCase() : '';
    return typed.indexOf('@') > 0 ? typed : '';
  }

  var loginAttached = '';
  var loginBusy = false;

  function rememberAttachedLogin(id) {
    var saved = readPurchaser() || {};
    saved.kajabiUserId = id;
    if (saved.email) writePurchaser(saved);
  }

  function attachCheckoutLogin() {
    var email = purchaserEmail();
    var kajabiUserId = readCookie('rl_user_id');
    if (!email || !kajabiUserId || loginBusy || loginAttached === email + '|' + kajabiUserId) return;
    var key = email + '|' + kajabiUserId;
    loginAttached = key;
    loginBusy = true;
    request('/api/v1/users/attach-login', {
      method: 'POST',
      admin: true,
      body: {
        email: email,
        kajabiUserId: kajabiUserId,
      },
    }).then(function () {
      loginBusy = false;
      rememberAttachedLogin(kajabiUserId);
    }).catch(function (error) {
      if (error.status !== 404) {
        loginBusy = false;
        if (loginAttached === key) loginAttached = '';
        return;
      }
      var saved = readPurchaser();
      if (!saved || !saved.email || !saved.name) {
        loginBusy = false;
        if (loginAttached === key) loginAttached = '';
        return;
      }
      registerPurchaser(saved).then(function () {
        return request('/api/v1/users/attach-login', {
          method: 'POST',
          admin: true,
          body: {
            email: email,
            kajabiUserId: kajabiUserId,
          },
        });
      }).then(function () {
        loginBusy = false;
        loginAttached = key;
        rememberAttachedLogin(kajabiUserId);
      }).catch(function () {
        loginBusy = false;
        loginAttached = '';
      });
    });
  }

  function currentOffer() {
    var offers = {
      x9qWfn6F: { plan: 'one_time', thankYou: PAGES.one_time },
      QR6K2fbh: { plan: 'eight_month', thankYou: PAGES.eight_month },
    };
    var match = window.location.pathname.match(/\/offers\/([^/]+)\/checkout/i);
    if (!match || !offers[match[1]]) return null;
    return {
      id: match[1],
      plan: offers[match[1]].plan,
      thankYou: offers[match[1]].thankYou,
    };
  }

  function checkoutEmailValue() {
    var found = '';
    var custom = document.querySelector('pds-input[component-id="email"]');
    if (custom && custom.value) found = String(custom.value).trim().toLowerCase();
    if (found.indexOf('@') < 1 && custom && custom.shadowRoot) {
      var inner = custom.shadowRoot.querySelector('input');
      if (inner && inner.value) found = inner.value.trim().toLowerCase();
    }
    if (found.indexOf('@') < 1) {
      var emailInput = document.querySelector('#email');
      if (emailInput && emailInput.value) found = emailInput.value.trim().toLowerCase();
    }
    return found.indexOf('@') > 0 ? found : '';
  }

  function checkoutNameValue() {
    var named = document.querySelector('#name, input[data-testid="name-input"]');
    return named && named.value ? named.value.trim() : '';
  }

  function rememberCheckout() {
    var offer = currentOffer();
    if (!offer) return null;
    var existing = readPurchaser() || {};
    var email = checkoutEmailValue() || existing.email || '';
    var name = checkoutNameValue() || existing.name || '';
    if (!email && !name) return existing.email ? existing : null;
    if (email) {
      try { localStorage.setItem(EMAIL_KEY, email); } catch (error) { /* storage can be blocked */ }
    }
    return writePurchaser({
      id: existing.id,
      name: name,
      email: email,
      token: existing.token || '',
      role: existing.role || '',
      kajabiUserId: existing.kajabiUserId || '',
      plan: offer.plan,
      offerId: offer.id,
      thankYou: offer.thankYou,
    });
  }

  function bootCheckout() {
    var savedCheckoutKey = '';
    var typedEmail = '';
    var typedName = '';
    function readCheckoutFields() {
      var emailHost = document.querySelector('pds-input[component-id="email"]');
      var emailInput = emailHost && emailHost.shadowRoot && emailHost.shadowRoot.querySelector('input');
      var email = typedEmail || checkoutEmailValue();
      if (!email && emailInput) {
        email = String(emailInput.value || '').trim().toLowerCase();
      }
      var name = typedName || checkoutNameValue();
      return { email: email.indexOf('@') > 0 ? email : '', name: name };
    }
    function watch(node, kind) {
      if (!node || node.getAttribute('data-course-sync-watch')) return;
      node.setAttribute('data-course-sync-watch', '1');
      node.addEventListener('input', function () {
        var value = node.value ? node.value.trim() : '';
        if (kind === 'email') typedEmail = value.toLowerCase();
        if (kind === 'name') typedName = value;
        rememberCheckout();
      });
    }
    function bindFields() {
      var emailHost = document.querySelector('pds-input[component-id="email"]');
      var emailInput = emailHost && emailHost.shadowRoot && emailHost.shadowRoot.querySelector('input');
      watch(emailInput, 'email');
      watch(document.querySelector('#name'), 'name');
    }
    function saveCheckoutUser() {
      var draft = rememberCheckout();
      if (!draft || !draft.email || !draft.name) return;
      var key = draft.email + '\n' + draft.name + '\n' + draft.plan;
      if (key === savedCheckoutKey) return;
      savedCheckoutKey = key;
      registerPurchaser(draft).catch(function () {
        savedCheckoutKey = '';
      });
    }
    bindFields();
    rememberCheckout();
    document.addEventListener('input', function () {
      bindFields();
      rememberCheckout();
    }, true);
    document.addEventListener('pointerdown', function (event) {
      var node = event.target && event.target.nodeType === 1 ? event.target : event.target && event.target.parentElement;
      var button = node && node.closest ? node.closest('button') : null;
      if (!button || button.getAttribute('data-testid') !== 'popup-submit-button') return;
      var fields = readCheckoutFields();
      if (fields.email) typedEmail = fields.email;
      if (fields.name) typedName = fields.name;
      rememberCheckout();
      saveCheckoutUser();
    }, true);
    window.setInterval(function () {
      bindFields();
      rememberCheckout();
      saveCheckoutUser();
    }, 500);
  }

  function boot() {
    if (currentOffer()) {
      bootCheckout();
      return;
    }
    if (!isInvitePage()) return;
    if (redirectIfNeeded()) return;
    lockPurchaserEmail();
    watchForm();
    fillPurchaserEmail();
    attachCheckoutLogin();
    var tries = 0;
    window.setInterval(function () {
      if (!formBound) watchForm();
      tries += 1;
      if (tries <= 20) {
        fillPurchaserEmail();
        attachCheckoutLogin();
      }
    }, 500);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
