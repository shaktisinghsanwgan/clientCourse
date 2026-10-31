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
    var nameInput = form.querySelector('#form_submission_name, input[name="form_submission[name]"]');
    var emailInput = form.querySelector('#form_submission_email, input[name="form_submission[email]"]');
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
    if (!form || form.getAttribute('data-course-sync-bound') === 'true') return;
    form.setAttribute('data-course-sync-bound', 'true');
    formBound = true;
    form.addEventListener('submit', function (event) {
      if (form.getAttribute('data-course-sync-linked') === 'true') return;
      var purchaser = readPurchaser();
      if (!purchaser || !purchaser.email || !purchaser.name) {
        event.preventDefault();
        event.stopPropagation();
        showFormError(form, 'Your checkout details were not saved in this browser. Finish checkout on this device, then send the invite.');
        return;
      }
      var fields = inviteFields(form);
      if (!fields.name || !fields.email || !fields.allowed) return;
      event.preventDefault();
      event.stopPropagation();
      var button = form.querySelector('#form-button, button[type="submit"]');
      if (button) button.disabled = true;
      registerPurchaser(purchaser).then(function (record) {
        return linkPartner(record, fields.name, fields.email).then(function () {
          return record;
        });
      }).then(function () {
        form.setAttribute('data-course-sync-linked', 'true');
        if (button) button.disabled = false;
        HTMLFormElement.prototype.submit.call(form);
      }).catch(function (error) {
        if (button) button.disabled = false;
        showFormError(form, error.message || 'Could not link your partner.');
      });
    }, true);
  }

  function boot() {
    if (!isInvitePage()) return;
    if (redirectIfNeeded()) return;
    lockPurchaserEmail();
    watchForm();
    window.setInterval(function () {
      lockPurchaserEmail();
      if (!formBound) watchForm();
    }, 500);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
