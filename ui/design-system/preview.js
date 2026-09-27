/* Demo interactions only. No network, authentication, storage or business logic. */
(() => {
  'use strict';
  const main = document.querySelector('#main');
  const status = document.querySelector('#preview-status');
  const dialog = document.querySelector('#sample-dialog');
  let dialogTrigger;

  function navigate(moveFocus = true) {
    const requested = location.hash.slice(1) || 'feed';
    if (requested === 'main') return;
    const pages = [...document.querySelectorAll('[data-page]')];
    const route = pages.some(page => page.dataset.page === requested) ? requested : 'not-found';
    for (const page of pages) page.hidden = page.dataset.page !== route;
    for (const link of document.querySelectorAll('[data-route]')) {
      if (link.dataset.route === route) link.setAttribute('aria-current', 'page');
      else link.removeAttribute('aria-current');
    }
    document.title = `${pages.find(page => !page.hidden).querySelector('h1').textContent} · KararVer UI`;
    if (dialog.open) dialog.close();
    if (moveFocus) {
      main.focus({ preventScroll: true });
      window.scrollTo({ top: 0, behavior: 'instant' });
    }
  }
  window.addEventListener('hashchange', () => navigate());
  navigate(false);

  function setFeedState(state) {
    for (const panel of document.querySelectorAll('[data-feed-panel]')) panel.hidden = panel.dataset.feedPanel !== state;
    for (const button of document.querySelectorAll('[data-feed-state]')) button.setAttribute('aria-pressed', String(button.dataset.feedState === state));
    const labels = { ready: 'Örnek akış gösteriliyor.', loading: 'Yükleme durumu örneği gösteriliyor.', empty: 'Boş akış örneği gösteriliyor.', error: 'Bağlantı hatası örneği gösteriliyor.' };
    status.textContent = labels[state];
  }
  for (const button of document.querySelectorAll('[data-feed-state]')) button.addEventListener('click', () => setFeedState(button.dataset.feedState));
  document.querySelector('#retry-feed').addEventListener('click', () => {
    setFeedState('ready');
    document.querySelector('[data-feed-state="ready"]').focus();
  });
  for (const button of document.querySelectorAll('[data-open-dialog]')) button.addEventListener('click', () => {
    dialogTrigger = button;
    dialog.showModal();
  });
  for (const button of document.querySelectorAll('[data-close-dialog]')) button.addEventListener('click', () => dialog.close());
  dialog.addEventListener('close', () => {
    if (dialogTrigger && dialogTrigger.getClientRects().length) dialogTrigger.focus();
  });
  document.querySelector('#confirm-dialog').addEventListener('click', () => {
    dialog.close();
    status.textContent = 'Örnek işlem onaylandı. Hiçbir veri değiştirilmedi.';
  });

  const form = document.querySelector('#sample-form');
  const feedback = document.querySelector('#form-feedback');
  const ids = ['question', 'option-a', 'option-b'];
  function errorFor(id) {
    const value = document.getElementById(id).value.trim();
    if (!value) return 'Bu alanı doldurmalısın.';
    if (id === 'question' && (value.length < 10 || value.length > 140)) return 'Sorun 10–140 karakter arasında olmalı.';
    if (id === 'option-b' && value.toLocaleLowerCase('tr') === document.getElementById('option-a').value.trim().toLocaleLowerCase('tr')) return 'İki farklı seçenek yazmalısın.';
    return '';
  }
  function showError(id, message) {
    const input = document.getElementById(id);
    const error = document.getElementById(`${id}-error`);
    input.setAttribute('aria-invalid', String(Boolean(message)));
    error.textContent = message;
    error.hidden = !message;
  }
  form.addEventListener('input', () => { feedback.textContent = ''; });
  for (const id of ids) document.getElementById(id).addEventListener('input', () => {
    if (document.getElementById(id).getAttribute('aria-invalid') === 'true') showError(id, errorFor(id));
    if (id === 'option-a' && document.getElementById('option-b').getAttribute('aria-invalid') === 'true') showError('option-b', errorFor('option-b'));
  });
  form.addEventListener('submit', event => {
    event.preventDefault();
    const errors = ids.map(id => ({ id, message: errorFor(id) }));
    for (const error of errors) showError(error.id, error.message);
    const first = errors.find(error => error.message);
    if (first) {
      feedback.textContent = 'Lütfen işaretli alanları kontrol et.';
      document.getElementById(first.id).focus();
    } else {
      feedback.textContent = 'Form doğrulandı. Bu önizlemede anket yayınlanmadı ve veriler saklanmadı.';
    }
  });
})();
