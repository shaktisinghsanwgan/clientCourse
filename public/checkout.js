(function () {
  var BASE_URL = 'https://web-production-b4f12.up.railway.app';
  var ADMIN_API_KEY = 'local-dev-admin-key';
  var STORAGE_KEY = 'courseSync.purchaser';
  var EMAIL_KEY = 'courseSync.purchaserEmail';
  var OFFERS = {
    x9qWfn6F: {
      plan: 'one_time',
      thankYou: 'https://www.reignitesex.com/invite-your-partner-one-time-payment',
    },
    QR6K2fbh: {
      plan: 'eight_month',
      thankYou: 'https://www.reignitesex.com/invite-your-partner-8-monthly-payments',
    },
  };

  function currentOffer() {
    var match = window.location.pathname.match(/\/offers\/([^/]+)\/checkout/i);
    if (!match || !OFFERS[match[1]]) return null;
    return {
      id: match[1],
      plan: OFFERS[match[1]].plan,
      thankYou: OFFERS[match[1]].thankYou,
    };
  }

  function readPurchaser() {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
    } catch (error) {
      return null;
    }
  }

  function fieldText(selector) {
    var field = document.querySelector(selector);
    return field && field.value ? field.value.trim() : '';
  }

  function looksLikeEmail(value) {
    var email = String(value || '').trim().toLowerCase();
    return email.indexOf('@') > 0 ? email : '';
  }

  function inputEmail(node) {
    if (!node || node.tagName !== 'INPUT') return '';
    var hint = [
      node.type,
      node.id,
      node.name,
      node.getAttribute('autocomplete'),
      node.getAttribute('placeholder'),
      node.getAttribute('aria-label'),
    ].join(' ').toLowerCase();
    if (node.type !== 'email' && hint.indexOf('email') === -1) return '';
    return looksLikeEmail(node.value);
  }

  function walkInputs(root, visit) {
    if (!root || !root.querySelectorAll) return;
    var nodes = root.querySelectorAll('input, pds-input');
    for (var index = 0; index < nodes.length; index += 1) {
      var node = nodes[index];
      if (node.tagName === 'INPUT') visit(node);
      if (node.shadowRoot) walkInputs(node.shadowRoot, visit);
    }
  }

  function checkoutEmail() {
    var found = '';
    var custom = document.querySelector('pds-input[component-id="email"]');
    if (custom) found = looksLikeEmail(custom.value);
    if (!found && custom && custom.shadowRoot) {
      var inner = custom.shadowRoot.querySelector('input');
      found = inner ? looksLikeEmail(inner.value) : '';
    }
    if (!found) {
      walkInputs(document, function (node) {
        if (!found) found = inputEmail(node);
      });
    }
    if (!found) {
      try {
        found = looksLikeEmail(localStorage.getItem(EMAIL_KEY));
      } catch (error) {
        found = '';
      }
    }
    return found;
  }

  function rememberEmail(email) {
    var value = looksLikeEmail(email);
    if (!value) return '';
    try {
      localStorage.setItem(EMAIL_KEY, value);
    } catch (error) {
      /* storage can be blocked */
    }
    return value;
  }

  function checkoutName() {
    var named = document.querySelector('#name, input[testid="name-input"], input[data-testid="name-input"]');
    return named && named.value ? named.value.trim() : '';
  }

  function rememberCheckoutPurchaser() {
    var offer = currentOffer();
    if (!offer) return null;
    var name = checkoutName();
    var email = rememberEmail(checkoutEmail());
    var existing = readPurchaser() || {};
    if (!name && !email && existing.email) {
      name = existing.name || '';
      email = existing.email;
    }
    if (!name && !email) return existing;
    var next = {
      id: existing.id,
      name: name || existing.name || '',
      email: email || existing.email || '',
      token: existing.token || '',
      role: existing.role || '',
      kajabiUserId: existing.kajabiUserId || '',
      plan: offer.plan,
      offerId: offer.id,
      thankYou: offer.thankYou,
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    return next;
  }

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
      if (node.id === 'name' || node.getAttribute('testid') === 'name-input' || node.getAttribute('data-testid') === 'name-input') {
        name = node.value.trim();
      }
        if (node.type === 'email' || (host && host.getAttribute('component-id') === 'email') || inputEmail(node)) {
        email = looksLikeEmail(node.value);
      }
    }
    if (name || email) {
      var offer = currentOffer();
      var existing = readPurchaser() || {};
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        id: existing.id,
        name: name || checkoutName() || existing.name || '',
        email: rememberEmail(email || checkoutEmail() || existing.email || ''),
        token: existing.token || '',
        role: existing.role || '',
        kajabiUserId: existing.kajabiUserId || '',
        plan: offer ? offer.plan : existing.plan || '',
        offerId: offer ? offer.id : existing.offerId || '',
        thankYou: offer ? offer.thankYou : existing.thankYou || '',
      }));
    }
    rememberCheckoutPurchaser();
  }

  function writePurchaser(record) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(record));
    return record;
  }

  function saveRegistered(result, draft) {
    var data = (result && result.data) || {};
    var user = data.user || {};
    return writePurchaser({
      id: user.id || draft.id,
      name: user.name || draft.name || '',
      email: rememberEmail(user.email || draft.email || ''),
      token: data.token || draft.token || '',
      role: user.role || draft.role || 'PRIMARY',
      kajabiUserId: user.kajabiUserId || draft.kajabiUserId || '',
      plan: draft.plan || '',
      offerId: draft.offerId || '',
      thankYou: draft.thankYou || '',
    });
  }

  function registerPurchaser(draft) {
    if (!draft || !draft.name || !draft.email) return Promise.resolve(draft);
    return fetch(BASE_URL + '/api/v1/users/register', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Api-Key': ADMIN_API_KEY,
      },
      keepalive: true,
      body: JSON.stringify({
        name: draft.name,
        email: draft.email,
        offerReference: draft.plan,
      }),
    }).then(function (response) {
      return response.text().then(function (text) {
        var data = text ? JSON.parse(text) : null;
        if (!response.ok) {
          var error = new Error((data && data.message) || ('Request failed (' + response.status + ')'));
          error.status = response.status;
          throw error;
        }
        return saveRegistered(data, draft);
      });
    }).catch(function () {
      return draft;
    });
  }

  function isPayClick(event) {
    var path = event && event.composedPath ? event.composedPath() : [];
    var node = event.target && event.target.nodeType === 1 ? event.target : event.target && event.target.parentElement;
    if (node) path = [node].concat(path);
    for (var index = 0; index < path.length; index += 1) {
      var item = path[index];
      if (!item || item.nodeType !== 1 || !item.getAttribute) continue;
      if (item.getAttribute('data-testid') === 'popup-submit-button') return true;
      if (item.tagName === 'BUTTON' && item.type === 'submit' && item.closest && item.closest('.embedded-checkout, form.embedded-checkout__body')) {
        return true;
      }
    }
    return false;
  }

  function boot() {
    if (!currentOffer()) return;
    rememberCheckoutPurchaser();
    document.addEventListener('input', capture, true);
    document.addEventListener('change', capture, true);
    document.addEventListener('keyup', capture, true);
    document.addEventListener('blur', capture, true);
    window.addEventListener('pagehide', function () {
      rememberCheckoutPurchaser();
    });
    window.setInterval(rememberCheckoutPurchaser, 1000);
    document.addEventListener('click', function (event) {
      if (!isPayClick(event)) return;
      registerPurchaser(rememberCheckoutPurchaser());
    }, true);
    document.addEventListener('submit', function (event) {
      var form = event.target;
      if (!form || !form.closest || !form.closest('.embedded-checkout')) return;
      registerPurchaser(rememberCheckoutPurchaser());
    }, true);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
