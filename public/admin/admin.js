(function () {
  var root = document.getElementById('app');
  var storageKey = 'courseSync.adminKey';
  var parts = window.location.pathname.split('/').filter(Boolean);
  var participantId = parts[0] === 'admin' && parts[1] === 'participants' ? parts[2] : '';

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  function api(path) {
    return fetch(path, { headers: { 'X-Api-Key': sessionStorage.getItem(storageKey) || '' } })
      .then(function (response) {
        return response.json().catch(function () { return {}; }).then(function (payload) {
          if (response.status === 401) {
            sessionStorage.removeItem(storageKey);
            throw new Error('Admin access was rejected.');
          }
          if (!response.ok || payload.success === false) throw new Error(payload.message || 'Request failed');
          return payload.data;
        });
      });
  }

  function downloadFile(participant, file) {
    return fetch('/api/v1/admin/participants/' + participant + '/files/' + file.id, {
      headers: { 'X-Api-Key': sessionStorage.getItem(storageKey) || '' },
    }).then(function (response) {
      if (!response.ok) throw new Error('The PDF could not be opened.');
      return response.blob();
    }).then(function (blob) {
      var url = URL.createObjectURL(blob);
      window.open(url, '_blank', 'noopener');
      setTimeout(function () { URL.revokeObjectURL(url); }, 60000);
    });
  }

  function gate(message) {
    root.replaceChildren();
    var card = el('form', 'gate');
    card.append(el('h1', '', 'Worksheet admin'));
    card.append(el('p', '', 'Enter the admin API key. It stays in this browser tab and is sent only to this server.'));
    var label = el('label', '', 'Admin API key');
    label.setAttribute('for', 'admin-key');
    var input = el('input');
    input.id = 'admin-key';
    input.type = 'password';
    input.autocomplete = 'current-password';
    input.required = true;
    var button = el('button', '', 'Continue');
    button.style.marginTop = '12px';
    var note = el('p', 'note', message || '');
    card.append(label, input, button, note);
    card.addEventListener('submit', function (event) {
      event.preventDefault();
      sessionStorage.setItem(storageKey, input.value.trim());
      boot();
    });
    root.append(card);
  }

  function ratingCell(person, weekNumber) {
    if (!person) return 'Not registered';
    var rating = (person.ratings || []).find(function (item) { return item.weekNumber === weekNumber; });
    if (!rating || rating.status !== 'submitted') return 'Not submitted';
    var when = rating.submittedAt ? new Date(rating.submittedAt).toLocaleString() : '';
    return 'Desire ' + rating.desireRating + ' / 10\nHappiness ' + rating.happinessRating + ' / 10\nConnection ' + rating.connectionRating + ' / 10\n' + when;
  }

  function worksheetLines(person, weekNumber) {
    if (!person) return 'Not registered';
    var week = (person.weeks || []).find(function (item) { return item.weekNumber === weekNumber; });
    if (!week) return 'No worksheets';
    return week.items.map(function (item) {
      if (item.kind === 'checklist') return item.title + ': ' + (item.completed ? 'done' : 'not done');
      return item.title + ': ' + (item.file ? item.file.filename : 'missing');
    }).join('\n');
  }

  function renderList(rows) {
    root.replaceChildren();
    root.append(el('h1', '', 'Participants'));
    root.append(el('p', '', 'Purchaser and partner ratings, worksheets, and portal links.'));
    var table = document.createElement('table');
    table.append(row(['Name', 'Role', 'Progress', 'Portal'], true));
    rows.forEach(function (person) {
      var link = el('a', 'link', 'Open');
      link.href = '/admin/participants/' + person.id;
      var progress = person.completedWeeks + ' of 8 · ' + person.percent + '%';
      table.append(row([person.name + '\n' + person.email, person.role, progress, link]));
    });
    root.append(table);
  }

  function row(cells, header) {
    var tr = document.createElement('tr');
    cells.forEach(function (cell) {
      var td = document.createElement(header ? 'th' : 'td');
      if (cell && cell.nodeType) td.append(cell);
      else td.textContent = String(cell == null ? '' : cell);
      tr.append(td);
    });
    return tr;
  }

  function personCard(title, person) {
    var card = el('article', 'card');
    card.append(el('h2', '', title));
    if (!person) {
      card.append(el('p', '', 'Not registered yet.'));
      return card;
    }
    var profile = person.profile;
    card.append(el('p', '', profile.name + ' · ' + profile.email));
    card.append(el('p', '', 'Kajabi id: ' + (profile.kajabiUserId || 'Not linked')));
    card.append(el('p', '', 'Contact id: ' + (profile.kajabiContactId || 'Not stored')));
    card.append(el('p', '', profile.progress.label + ' · ' + profile.progress.percent + '% complete'));
    if (profile.portalUrl) card.append(el('p', '', profile.portalUrl));
    return card;
  }

  function renderDetail(detail) {
    root.replaceChildren();
    var back = el('a', 'link quiet', 'All participants');
    back.href = '/admin/participants';
    root.append(back);
    root.append(el('h1', '', detail.programName));
    var people = el('div', 'people');
    people.append(personCard('Purchaser', detail.purchaser), personCard('Partner', detail.partner));
    root.append(people);
    if (detail.invitation) {
      root.append(el('p', '', 'Invited partner: ' + detail.invitation.name + ' · ' + detail.invitation.email));
    }
    root.append(el('h2', '', 'Weekly ratings'));
    var ratings = document.createElement('table');
    ratings.append(row(['Week', 'Purchaser', 'Partner'], true));
    for (var week = 1; week <= 8; week += 1) {
      ratings.append(row([
        'Week ' + week,
        ratingCell(detail.purchaser, week),
        ratingCell(detail.partner, week),
      ]));
    }
    root.append(ratings);
    root.append(el('h2', '', 'Worksheets'));
    var sheets = document.createElement('table');
    sheets.append(row(['Week', 'Purchaser', 'Partner'], true));
    for (var sheetWeek = 1; sheetWeek <= 8; sheetWeek += 1) {
      sheets.append(row([
        'Week ' + sheetWeek,
        worksheetCell(detail.purchaser, sheetWeek),
        worksheetCell(detail.partner, sheetWeek),
      ]));
    }
    root.append(sheets);
  }

  function worksheetCell(person, weekNumber) {
    var wrap = el('div');
    wrap.append(el('p', '', worksheetLines(person, weekNumber)));
    if (!person) return wrap;
    var week = (person.weeks || []).find(function (item) { return item.weekNumber === weekNumber; });
    (week ? week.items : []).forEach(function (item) {
      if (!item.file) return;
      var button = el('button', 'quiet', 'Open ' + item.file.filename);
      button.type = 'button';
      button.style.margin = '4px 4px 0 0';
      button.addEventListener('click', function () {
        downloadFile(person.profile.id, item.file).catch(function (error) {
          window.alert(error.message);
        });
      });
      wrap.append(button);
    });
    return wrap;
  }

  function boot() {
    if (!sessionStorage.getItem(storageKey)) {
      gate('');
      return;
    }
    var path = participantId
      ? '/api/v1/admin/participants/' + encodeURIComponent(participantId)
      : '/api/v1/admin/participants';
    api(path).then(participantId ? renderDetail : renderList).catch(function (error) {
      gate(error.message);
    });
  }

  boot();
}());
