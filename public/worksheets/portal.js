(function () {
  var parts = window.location.pathname.split('/').filter(Boolean);
  var token = parts[0] === 'worksheets' ? parts[1] : '';
  var state = null;
  var selectedWeek = 1;
  var editing = false;
  var openWeek = 1;

  var loader = document.getElementById('loader');
  var errorScreen = document.getElementById('error');
  var errorMessage = document.getElementById('error-message');
  var app = document.getElementById('app');
  var form = document.getElementById('rating-form');
  var note = document.getElementById('form-note');
  var modal = document.getElementById('modal');

  function showError(message) {
    loader.hidden = true;
    app.hidden = true;
    errorScreen.hidden = false;
    errorMessage.textContent = message || 'This worksheet link is invalid or has expired.';
  }

  function request(path, options) {
    var headers = {};
    var body = options && options.body ? JSON.stringify(options.body) : undefined;
    if (body) headers['Content-Type'] = 'application/json';
    return fetch('/api/v1/worksheets/' + encodeURIComponent(token) + path, {
      method: options && options.method ? options.method : 'GET',
      headers: headers,
      body: body,
    }).then(function (response) {
      return response.json().catch(function () { return {}; }).then(function (payload) {
        if (!response.ok || payload.success === false) {
          var error = new Error(payload.message || 'The worksheet portal could not be loaded.');
          error.status = response.status;
          throw error;
        }
        return payload.data;
      });
    });
  }

  function statusLabel(status) {
    if (status === 'completed') return 'Completed';
    if (status === 'in_progress') return 'In Progress';
    return 'Pending';
  }

  function currentWeek() {
    return state.weeks.find(function (week) { return week.weekNumber === selectedWeek; }) || state.weeks[0];
  }

  function ratingNumber(input) {
    var value = String(input.value || '').trim();
    if (!value) return null;
    if (!/^\d+$/.test(value)) return undefined;
    var number = Number(value);
    if (number < 1 || number > 10) return undefined;
    return number;
  }

  function setBusy(busy) {
    document.getElementById('save-progress').disabled = busy;
    document.getElementById('submit-week').disabled = busy;
  }

  function renderProgress() {
    document.getElementById('program').textContent = state.participant.programName;
    document.getElementById('participant-name').textContent = state.participant.name;
    document.getElementById('participant-role').textContent = state.participant.role === 'partner' ? 'Partner' : 'Purchaser';
    document.getElementById('progress-label').textContent = state.progress.label;
    document.getElementById('progress-percent').textContent = state.progress.percent + '% Complete';
    document.getElementById('progress-bar').style.width = state.progress.percent + '%';
  }

  function renderWeeks() {
    var list = document.getElementById('weeks');
    list.replaceChildren();
    state.weeks.forEach(function (week) {
      var button = document.createElement('button');
      button.type = 'button';
      button.className = 'week-tab';
      button.setAttribute('role', 'tab');
      button.setAttribute('aria-selected', week.weekNumber === selectedWeek ? 'true' : 'false');
      var title = document.createElement('strong');
      title.textContent = 'Week ' + week.weekNumber;
      var status = document.createElement('small');
      status.textContent = statusLabel(week.status);
      button.append(title, status);
      button.addEventListener('click', function () {
        selectedWeek = week.weekNumber;
        editing = false;
        note.textContent = '';
        render();
      });
      list.append(button);
    });
  }

  function renderForm() {
    var week = currentWeek();
    var submitted = week.rating && week.rating.status === 'submitted';
    var locked = submitted && !editing;
    document.getElementById('rating-heading').textContent = 'Week ' + week.weekNumber + ' ' + state.copy.headingSuffix;
    document.getElementById('rating-description').textContent = state.copy.description;
    form.replaceChildren();
    state.questions.forEach(function (question) {
      var label = document.createElement('label');
      label.className = 'question';
      var text = document.createElement('span');
      text.textContent = question.label;
      var score = document.createElement('span');
      score.className = 'score';
      var input = document.createElement('input');
      input.type = 'number';
      input.min = '1';
      input.max = '10';
      input.step = '1';
      input.inputMode = 'numeric';
      input.name = question.key;
      input.setAttribute('aria-label', question.label);
      input.required = true;
      input.disabled = locked;
      if (week.rating && week.rating[question.key] != null) input.value = String(week.rating[question.key]);
      var suffix = document.createElement('b');
      suffix.textContent = '/10';
      var error = document.createElement('p');
      error.className = 'field-error';
      error.hidden = true;
      score.append(input, suffix);
      label.append(text, score, error);
      form.append(label);
    });
    document.getElementById('save-progress').hidden = locked;
    document.getElementById('submit-week').hidden = locked;
    document.getElementById('submit-week').textContent = editing ? 'Update submission' : 'Submit Week';
    document.getElementById('edit-week').hidden = !locked;
    if (submitted && week.rating.submittedAt) {
      note.textContent = 'Submitted ' + new Date(week.rating.submittedAt).toLocaleString();
    }
  }

  function render() {
    renderProgress();
    renderWeeks();
    renderForm();
    if (!modal.hidden) renderWorksheets();
  }

  function valuesFromForm(requireAll) {
    var values = { weekNumber: selectedWeek };
    var valid = true;
    Array.prototype.forEach.call(form.querySelectorAll('input'), function (input) {
      var number = ratingNumber(input);
      var error = input.closest('label').querySelector('.field-error');
      input.removeAttribute('aria-invalid');
      error.hidden = true;
      if (number === undefined || (requireAll && number == null)) {
        valid = false;
        input.setAttribute('aria-invalid', 'true');
        error.hidden = false;
        error.textContent = 'Enter a whole number from 1 to 10.';
      }
      values[input.name] = number == null ? null : number;
    });
    return valid ? values : null;
  }

  function applyState(next) {
    state = next;
    if (!state.weeks.some(function (week) { return week.weekNumber === selectedWeek; })) {
      selectedWeek = state.progress.currentWeek || 1;
    }
    editing = false;
    render();
  }

  function save(kind) {
    var requireAll = kind === 'submit';
    var values = valuesFromForm(requireAll);
    if (!values) {
      note.textContent = 'Each rating must be a whole number from 1 to 10.';
      return;
    }
    if (!requireAll && values.desireRating == null && values.happinessRating == null && values.connectionRating == null) {
      note.textContent = 'Enter at least one rating before saving.';
      return;
    }
    if (requireAll && (editing || (currentWeek().rating && currentWeek().rating.status === 'submitted'))) {
      values.edit = true;
    }
    setBusy(true);
    note.textContent = requireAll ? 'Submitting week…' : 'Saving progress…';
    request(requireAll ? '/ratings/submit' : '/ratings/draft', { method: 'POST', body: values })
      .then(function (data) {
        note.textContent = requireAll ? 'Week submitted.' : 'Progress saved.';
        applyState(data);
      })
      .catch(function (error) {
        note.textContent = error.message;
      })
      .finally(function () { setBusy(false); });
  }

  function renderWorksheets() {
    var list = document.getElementById('worksheet-list');
    list.replaceChildren();
    state.weeks.forEach(function (week) {
      var block = document.createElement('section');
      block.className = 'week-block';
      var toggle = document.createElement('button');
      toggle.type = 'button';
      toggle.className = 'week-toggle';
      toggle.setAttribute('aria-expanded', openWeek === week.weekNumber ? 'true' : 'false');
      var label = document.createElement('span');
      var title = document.createElement('strong');
      title.textContent = 'Week ' + week.weekNumber;
      label.append(title);
      var status = document.createElement('span');
      status.className = 'status ' + week.status;
      status.textContent = statusLabel(week.status);
      toggle.append(label, status);
      toggle.addEventListener('click', function () {
        openWeek = openWeek === week.weekNumber ? 0 : week.weekNumber;
        renderWorksheets();
      });
      block.append(toggle);
      if (openWeek === week.weekNumber) {
        var body = document.createElement('div');
        body.className = 'week-body';
        week.items.forEach(function (item) {
          body.append(item.kind === 'checklist' ? checklistItem(week, item) : pdfItem(week, item));
        });
        block.append(body);
      }
      list.append(block);
    });
  }

  function checklistItem(week, item) {
    var row = document.createElement('div');
    row.className = 'item';
    var label = document.createElement('label');
    label.className = 'check';
    var input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = item.completed;
    var text = document.createElement('span');
    text.textContent = item.title;
    label.append(input, text);
    input.addEventListener('change', function () {
      input.disabled = true;
      request('/checklist', {
        method: 'POST',
        body: { weekNumber: week.weekNumber, itemKey: item.key, completed: input.checked },
      }).then(applyState).catch(function (error) {
        input.checked = !input.checked;
        note.textContent = error.message;
      }).finally(function () { input.disabled = false; });
    });
    row.append(label);
    return row;
  }

  function pdfItem(week, item) {
    var row = document.createElement('div');
    row.className = 'item';
    var line = document.createElement('div');
    line.className = 'item-row';
    var copy = document.createElement('div');
    var title = document.createElement('strong');
    title.textContent = item.title;
    copy.append(title);
    if (item.file) {
      var meta = document.createElement('p');
      meta.textContent = item.file.filename + ' · ' + new Date(item.file.uploadedAt).toLocaleString();
      copy.append(meta);
    } else {
      var empty = document.createElement('p');
      empty.textContent = 'No PDF uploaded';
      copy.append(empty);
    }
    var actions = document.createElement('div');
    actions.className = 'file-actions';
    var input = document.createElement('input');
    input.className = 'file-input';
    input.type = 'file';
    input.accept = 'application/pdf,.pdf';
    var upload = document.createElement('button');
    upload.type = 'button';
    upload.className = 'text-button';
    upload.textContent = item.file ? 'Replace PDF' : 'Upload PDF';
    upload.addEventListener('click', function () { input.click(); });
    actions.append(upload);
    if (item.file) {
      var view = document.createElement('a');
      view.className = 'text-button';
      view.href = '/api/v1/worksheets/' + encodeURIComponent(token) + '/files/' + item.file.id;
      view.target = '_blank';
      view.rel = 'noopener';
      view.textContent = 'View PDF';
      var remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'text-button';
      remove.textContent = 'Delete PDF';
      remove.addEventListener('click', function () {
        if (!window.confirm('Delete this worksheet PDF?')) return;
        request('/files/' + item.file.id, { method: 'DELETE' }).then(applyState).catch(function (error) {
          note.textContent = error.message;
        });
      });
      actions.append(view, remove);
    }
    input.addEventListener('change', function () {
      var file = input.files && input.files[0];
      input.value = '';
      if (!file) return;
      uploadFile(week.weekNumber, item.key, file, copy).then(applyState).catch(function (error) {
        var message = document.createElement('p');
        message.textContent = error.message;
        copy.append(message);
      });
    });
    line.append(copy, actions);
    row.append(line);
    return row;
  }

  function uploadFile(weekNumber, worksheetKey, file, copy) {
    return new Promise(function (resolve, reject) {
      var bar = document.createElement('div');
      bar.className = 'progress-line';
      var fill = document.createElement('span');
      fill.style.width = '0%';
      bar.append(fill);
      copy.append(bar);
      var body = new FormData();
      body.append('weekNumber', String(weekNumber));
      body.append('worksheetKey', worksheetKey);
      body.append('file', file);
      var xhr = new XMLHttpRequest();
      xhr.open('POST', '/api/v1/worksheets/' + encodeURIComponent(token) + '/files');
      xhr.upload.onprogress = function (event) {
        if (event.lengthComputable) fill.style.width = Math.round((event.loaded / event.total) * 100) + '%';
      };
      xhr.onload = function () {
        var payload = {};
        try { payload = JSON.parse(xhr.responseText || '{}'); } catch (error) { payload = {}; }
        if (xhr.status >= 200 && xhr.status < 300 && payload.success) resolve(payload.data);
        else reject(new Error(payload.message || 'Upload failed'));
      };
      xhr.onerror = function () { reject(new Error('Upload failed')); };
      xhr.send(body);
    });
  }

  document.getElementById('save-progress').addEventListener('click', function () { save('draft'); });
  document.getElementById('submit-week').addEventListener('click', function () { save('submit'); });
  document.getElementById('edit-week').addEventListener('click', function () {
    editing = true;
    note.textContent = '';
    renderForm();
  });
  document.getElementById('open-worksheets').addEventListener('click', function () {
    openWeek = state.progress.currentWeek || selectedWeek;
    modal.hidden = false;
    renderWorksheets();
    document.getElementById('close-worksheets').focus();
  });
  document.getElementById('close-worksheets').addEventListener('click', function () { modal.hidden = true; });
  modal.addEventListener('click', function (event) { if (event.target === modal) modal.hidden = true; });
  document.addEventListener('keydown', function (event) {
    if (event.key === 'Escape' && !modal.hidden) modal.hidden = true;
  });

  if (!token) {
    showError('This worksheet link is invalid or has expired.');
    return;
  }
  request('').then(function (data) {
    loader.hidden = true;
    app.hidden = false;
    selectedWeek = data.progress.currentWeek || 1;
    openWeek = selectedWeek;
    applyState(data);
  }).catch(function (error) {
    showError(error.message);
  });
}());
