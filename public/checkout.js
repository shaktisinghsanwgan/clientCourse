(function () {
  var STORAGE_KEY = 'courseSync.purchaser';
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

  function checkoutEmail() {
    var custom = document.querySelector('pds-input[component-id="email"]');
    if (custom && custom.value) return String(custom.value).trim();
    if (custom && custom.shadowRoot) {
      var inner = custom.shadowRoot.querySelector('input');
      if (inner && inner.value) return inner.value.trim();
    }
    return fieldText('input[type="email"]');
  }

  function checkoutName() {
    var named = document.querySelector('#name, input[testid="name-input"], input[data-testid="name-input"]');
    return named && named.value ? named.value.trim() : '';
  }

  function rememberCheckoutPurchaser() {
    var offer = currentOffer();
    if (!offer) return null;
    var name = checkoutName();
    var email = checkoutEmail();
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
      if (node.type === 'email' || (host && host.getAttribute('component-id') === 'email')) {
        email = node.value.trim();
      }
    }
    if (name || email) {
      var offer = currentOffer();
      var existing = readPurchaser() || {};
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        id: existing.id,
        name: name || checkoutName() || existing.name || '',
        email: email || checkoutEmail() || existing.email || '',
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

  function boot() {
    if (!currentOffer()) return;
    rememberCheckoutPurchaser();
    document.addEventListener('input', capture, true);
    document.addEventListener('change', capture, true);
    window.setInterval(rememberCheckoutPurchaser, 1000);
    document.addEventListener('click', function (event) {
      var node = event.target && event.target.nodeType === 1 ? event.target : event.target && event.target.parentElement;
      if (!node || !node.closest) return;
      if (!node.closest('[data-testid="popup-submit-button"]')) return;
      rememberCheckoutPurchaser();
    }, true);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
