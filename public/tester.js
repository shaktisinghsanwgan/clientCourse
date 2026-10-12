const fields = {
  baseUrl: document.querySelector('#base-url'),
  adminKey: document.querySelector('#admin-key'),
  health: document.querySelector('#health-status'),
  purchaserName: document.querySelector('#purchaser-name'),
  purchaserEmail: document.querySelector('#purchaser-email'),
  purchaserKajabi: document.querySelector('#purchaser-kajabi'),
  userId: document.querySelector('#user-id'),
  chapterName: document.querySelector('#chapter-name'),
  purchaserSession: document.querySelector('#purchaser-session'),
  partnerName: document.querySelector('#partner-name'),
  partnerEmail: document.querySelector('#partner-email'),
  partnerSession: document.querySelector('#partner-session'),
  weekNumber: document.querySelector('#week-number'),
  chapterId: document.querySelector('#chapter-id'),
  completed: document.querySelector('#completed'),
  responseMeta: document.querySelector('#response-meta'),
  responseBody: document.querySelector('#response-body'),
};

const sessions = {
  purchaser: loadSession('purchaser'),
  partner: loadSession('partner'),
};

fields.baseUrl.value = localStorage.getItem('tester.baseUrl') || window.location.origin;
const savedAdminKey = localStorage.getItem('tester.adminKey');
fields.adminKey.value = savedAdminKey || fields.adminKey.value || 'local-dev-admin-key';
renderSessions();

fields.baseUrl.addEventListener('change', () => localStorage.setItem('tester.baseUrl', fields.baseUrl.value.trim()));
fields.adminKey.addEventListener('change', () => localStorage.setItem('tester.adminKey', fields.adminKey.value));

document.querySelector('#health-button').addEventListener('click', () => request({
  method: 'GET',
  path: '/api/v1/health',
}));

document.body.addEventListener('click', (event) => {
  const button = event.target.closest('button[data-action]');
  if (!button) return;
  runAction(button.dataset.action, button.dataset.who);
});

function loadSession(name) {
  try {
    return JSON.parse(localStorage.getItem(`tester.${name}`)) || {};
  } catch {
    return {};
  }
}

function saveSession(name) {
  localStorage.setItem(`tester.${name}`, JSON.stringify(sessions[name]));
  renderSessions();
}

function renderSessions() {
  fields.purchaserSession.textContent = sessionLabel(sessions.purchaser);
  fields.partnerSession.textContent = sessionLabel(sessions.partner);
  fields.purchaserSession.className = `session${sessions.purchaser.token ? ' ok' : ''}`;
  fields.partnerSession.className = `session${sessions.partner.token ? ' ok' : ''}`;
}

function sessionLabel(session) {
  if (!session.token) return 'No token yet';
  const user = session.user || {};
  return `${user.name || 'User'} · ${user.email || ''} · ${user.role || 'signed in'}`;
}

function actor() {
  return document.querySelector('input[name="actor"]:checked').value;
}

function person(who) {
  if (who === 'partner') {
    return {
      name: fields.partnerName.value.trim(),
      email: fields.partnerEmail.value.trim(),
    };
  }
  return {
    name: fields.purchaserName.value.trim(),
    email: fields.purchaserEmail.value.trim(),
    kajabiCustomerId: fields.purchaserKajabi.value.trim(),
  };
}

async function runAction(action, who) {
  if (action === 'register') {
    const purchaser = person('purchaser');
    const result = await request({
      method: 'POST',
      path: '/api/v1/users/register',
      admin: true,
      body: {
        name: purchaser.name,
        email: purchaser.email,
        kajabiCustomerId: purchaser.kajabiCustomerId || undefined,
      },
    });
    if (result?.data?.token) {
      sessions.purchaser = { token: result.data.token, user: result.data.user };
      saveSession('purchaser');
    }
    if (result?.data?.user?.id) {
      fields.userId.value = result.data.user.id;
    }
    return result;
  }

  if (action === 'verify-user') {
    return request({
      method: 'GET',
      path: `/api/v1/users/${fields.userId.value.trim()}`,
    });
  }

  if (action === 'update-user') {
    const current = person(who);
    return request({
      method: 'PATCH',
      path: `/api/v1/users/${fields.userId.value.trim()}`,
      body: { name: current.name, email: current.email },
    });
  }

  if (action === 'course-by-user') {
    return request({
      method: 'GET',
      path: `/api/v1/course/sync?userId=${encodeURIComponent(fields.userId.value.trim())}`,
    });
  }

  if (action === 'progress-by-name') {
    return request({
      method: 'POST',
      path: '/api/v1/chapters/progress',
      body: {
        userId: Number(fields.userId.value.trim()),
        chapters: [{ chapterName: fields.chapterName.value.trim(), completed: fields.completed.checked }],
      },
    });
  }

  if (action === 'login') {
    const result = await request({
      method: 'POST',
      path: '/api/v1/users/login',
      body: { email: person(who).email },
    });
    if (result?.data?.token) {
      sessions[who] = { token: result.data.token, user: result.data.user };
      saveSession(who);
    }
    return result;
  }

  if (action === 'link') {
    return request({
      method: 'POST',
      path: '/api/v1/partners/link',
      auth: 'purchaser',
      body: {
        partnerName: person('partner').name,
        partnerEmail: person('partner').email,
        purchaserUserId: fields.userId.value.trim() ? Number(fields.userId.value.trim()) : undefined,
      },
    });
  }

  if (action === 'me') {
    return request({ method: 'GET', path: '/api/v1/users/me', auth: who });
  }

  if (action === 'partnership') {
    return request({ method: 'GET', path: '/api/v1/partners/me', auth: actor() });
  }

  if (action === 'sync-chapters') {
    return request({
      method: 'POST',
      path: '/api/v1/chapters/sync',
      admin: true,
      body: { chapters: sampleChapters() },
    });
  }

  if (action === 'course' || action === 'course-sync' || action === 'progress-me') {
    if (actor() === 'partner') {
      const purchaserEmail = encodeURIComponent(person('purchaser').email);
      return request({
        method: 'GET',
        path: `/api/v1/progress/partner?purchaserEmail=${purchaserEmail}`,
      });
    }
    const path = action === 'course'
      ? '/api/v1/course'
      : action === 'course-sync'
        ? '/api/v1/course/sync'
        : '/api/v1/progress/me';
    return request({ method: 'GET', path, auth: 'purchaser' });
  }
  if (action === 'week-chapters') {
    return request({
      method: 'GET',
      path: `/api/v1/chapters/week/${fields.weekNumber.value}`,
      auth: actor(),
    });
  }
  if (action === 'complete') {
    return request({
      method: 'POST',
      path: '/api/v1/chapters/complete',
      auth: actor(),
      body: {
        chapterId: fields.chapterId.value.trim(),
        completed: fields.completed.checked,
      },
    });
  }
  if (action === 'progress-me') return request({ method: 'GET', path: '/api/v1/progress/me', auth: actor() });
  if (action === 'progress-week') {
    return request({
      method: 'GET',
      path: `/api/v1/progress/week/${fields.weekNumber.value}`,
      auth: actor(),
    });
  }
  return null;
}

function sampleChapters() {
  const counts = [5, 4, 6, 5, 4, 6, 5, 4];
  return counts.flatMap((count, index) => {
    const weekNumber = index + 1;
    return Array.from({ length: count }, (_, chapterIndex) => ({
      weekNumber,
      chapterId: `week-${weekNumber}-chapter-${chapterIndex + 1}`,
      chapterName: `Week ${weekNumber} Chapter ${chapterIndex + 1}`,
      chapterOrder: chapterIndex + 1,
      isActive: true,
    }));
  });
}

async function request({ method, path, body, auth, admin }) {
  const base = (fields.baseUrl.value || window.location.origin).replace(/\/$/, '');
  const headers = {};
  if (body) headers['Content-Type'] = 'application/json';
  if (admin) headers['X-Api-Key'] = fields.adminKey.value;
  if (auth) {
    const token = sessions[auth]?.token;
    if (!token) {
      showResult({ method, path, status: 0, body: { success: false, message: `Missing ${auth} token. Register or sign in first.` } });
      return null;
    }
    headers.Authorization = `Bearer ${token}`;
  }

  const buttons = [...document.querySelectorAll('button')];
  buttons.forEach((button) => { button.disabled = true; });
  try {
    const response = await fetch(`${base}${path}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await response.text();
    let parsed = text;
    try { parsed = JSON.parse(text); } catch { parsed = text; }
    showResult({ method, path, status: response.status, body: parsed });
    if (path === '/api/v1/health') {
      fields.health.textContent = response.ok ? 'Database up' : 'Health check failed';
      fields.health.className = `status ${response.ok ? 'ok' : 'bad'}`;
    }
    return parsed;
  } catch (error) {
    showResult({ method, path, status: 0, body: { success: false, message: error.message } });
    return null;
  } finally {
    buttons.forEach((button) => { button.disabled = false; });
  }
}

function showResult({ method, path, status, body }) {
  fields.responseMeta.textContent = `${method} ${path} · ${status || 'network error'}`;
  fields.responseBody.textContent = typeof body === 'string' ? body : JSON.stringify(body, null, 2);
}
