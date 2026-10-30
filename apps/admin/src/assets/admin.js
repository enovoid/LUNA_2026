// 관리자 화면 보조 스크립트. 없어도 모든 기능이 일반 폼으로 동작한다.
// - 사진: 고르는 즉시 미리 보여 주고 뒤에서 올린다(진행률 표시). 저장을 누르면 올리기가 끝나는 대로 저장한다.
// - 사이트 반영 상태: 작업이 도는 동안 머리글의 표시를 몇 초마다 새로 고친다.
// - 삭제 확인, 목록 검색
// 비밀 값은 없다. 권한 확인은 모두 서버가 한다.
(() => {
  document.addEventListener('submit', (event) => {
    const form = event.target;
    if (!(form instanceof HTMLFormElement)) return;
    const message = form.dataset.confirm;
    if (message && !window.confirm(message)) event.preventDefault();
  });

  for (const box of document.querySelectorAll('[data-upload]')) setupUpload(box);
  for (const form of document.querySelectorAll('form[data-import]')) setupImport(form);
  setupFilter();
  setupStatus();

  function setupUpload(box) {
    const form = box.closest('form');
    const file = box.querySelector('input[type=file]');
    const key = box.querySelector('input[name=imageKey]');
    const preview = box.querySelector('[data-preview]');
    const bar = box.querySelector('progress');
    const status = box.querySelector('[data-upload-status]');
    const remove = box.querySelector('input[name=removeImage]');
    const submit = form?.querySelector('button[type=submit]:not([formaction])');
    const maxBytes = Number(box.dataset.maxBytes || 0);
    if (!form || !file || !key || !preview || !bar || !status) return;

    let pending = null;
    let waiting = false;
    const label = submit?.textContent ?? '';

    const say = (text, tone) => {
      status.textContent = text;
      if (tone) status.dataset.tone = tone;
      else delete status.dataset.tone;
    };

    file.addEventListener('change', () => {
      const chosen = file.files?.[0];
      if (!chosen) return;
      if (!chosen.type.startsWith('image/')) {
        say('사진 파일만 올릴 수 있어요.', 'error');
        file.value = '';
        return;
      }
      if (maxBytes && chosen.size > maxBytes) {
        say(`사진은 ${Math.round(maxBytes / 1024 / 1024)}MB까지 올릴 수 있어요.`, 'error');
        file.value = '';
        return;
      }
      showPreview(URL.createObjectURL(chosen));
      if (remove) remove.checked = false;
      pending = upload(chosen);
    });

    function showPreview(src) {
      if (preview instanceof HTMLImageElement) {
        preview.src = src;
        return;
      }
      const img = document.createElement('img');
      img.className = 'photo-preview';
      img.alt = '';
      img.dataset.preview = '';
      img.src = src;
      preview.replaceWith(img);
    }

    function upload(chosen) {
      return new Promise((resolve) => {
        const xhr = new XMLHttpRequest();
        xhr.open('POST', box.dataset.upload);
        xhr.responseType = 'json';
        bar.hidden = false;
        bar.removeAttribute('value');
        say('사진 올리는 중…');
        xhr.upload.addEventListener('progress', (e) => {
          if (!e.lengthComputable) return;
          bar.max = e.total;
          bar.value = e.loaded;
          say(
            e.loaded < e.total
              ? `사진 올리는 중… ${Math.round((e.loaded / e.total) * 100)}%`
              : '사진 다듬는 중…',
          );
        });
        xhr.addEventListener('load', () => {
          const body = xhr.response || {};
          if (xhr.status === 200 && body.imageKey) {
            key.value = body.imageKey;
            // 이미 올렸으니 저장할 때 파일을 다시 보내지 않는다.
            file.value = '';
            bar.hidden = true;
            say('사진 준비 완료. 저장하면 반영돼요.', 'ok');
            resolve(true);
          } else {
            fail(body.error || '사진을 올리지 못했어요.');
            resolve(false);
          }
        });
        xhr.addEventListener('error', () => {
          fail('연결이 끊겨 사진을 올리지 못했어요. 저장하면 사진과 함께 다시 보내요.');
          resolve(false);
        });
        xhr.setRequestHeader('Content-Type', chosen.type || 'application/octet-stream');
        xhr.send(chosen);
      }).finally(() => {
        pending = null;
        if (waiting) {
          waiting = false;
          form.requestSubmit(submit ?? undefined);
        }
      });
    }

    function fail(text) {
      bar.hidden = true;
      key.value = '';
      say(text, 'error');
    }

    form.addEventListener('submit', (event) => {
      if (!pending) {
        if (submit) {
          submit.disabled = true;
          submit.textContent = '저장 중…';
        }
        return;
      }
      // 사진이 아직 올라가는 중: 끝나면 이어서 저장한다.
      event.preventDefault();
      waiting = true;
      if (submit) {
        submit.disabled = true;
        submit.textContent = '사진 올린 뒤 저장할게요…';
      }
    });

    window.addEventListener('pageshow', () => {
      if (submit) {
        submit.disabled = false;
        submit.textContent = label;
      }
    });
  }

  // Notion 내보내기 zip: 페이지를 떠나지 않고 올리고, 가져오기는 서버가 뒤에서 한다.
  function setupImport(form) {
    const file = form.querySelector('input[type=file]');
    const bar = form.querySelector('progress');
    const status = form.querySelector('[data-upload-status]');
    const button = form.querySelector('button[type=submit]');
    const maxBytes = Number(form.dataset.maxBytes || 0);
    if (!file || !bar || !status || !button) return;
    const say = (text, tone) => {
      status.textContent = text;
      if (tone) status.dataset.tone = tone;
      else delete status.dataset.tone;
    };
    form.addEventListener('submit', (event) => {
      const chosen = file.files?.[0];
      if (!chosen) return;
      event.preventDefault();
      if (maxBytes && chosen.size > maxBytes) {
        say(`zip은 ${Math.round(maxBytes / 1024 / 1024)}MB까지 올릴 수 있어요.`, 'error');
        return;
      }
      const xhr = new XMLHttpRequest();
      xhr.open('POST', form.dataset.import);
      xhr.responseType = 'json';
      xhr.setRequestHeader('Accept', 'application/json');
      xhr.setRequestHeader('Content-Type', 'application/zip');
      button.disabled = true;
      bar.hidden = false;
      bar.removeAttribute('value');
      say('올리는 중…');
      xhr.upload.addEventListener('progress', (e) => {
        if (!e.lengthComputable) return;
        bar.max = e.total;
        bar.value = e.loaded;
        say(`올리는 중… ${Math.round((e.loaded / e.total) * 100)}%`);
      });
      const done = (ok, text) => {
        bar.hidden = true;
        button.disabled = false;
        say(text, ok ? 'ok' : 'error');
        if (ok) {
          file.value = '';
          document.dispatchEvent(new Event('luna:jobs'));
        }
      };
      xhr.addEventListener('load', () => {
        const body = xhr.response || {};
        if (xhr.status === 200 && body.ok)
          done(true, '올렸어요. 뒤에서 가져오는 중이에요. 다른 일 하셔도 돼요.');
        else done(false, body.error || '파일을 받지 못했어요.');
      });
      xhr.addEventListener('error', () =>
        done(false, '연결이 끊겨 올리지 못했어요. 다시 시도해 주세요.'),
      );
      xhr.send(chosen);
    });
  }

  function setupFilter() {
    const input = document.querySelector('[data-filter]');
    const list = document.querySelector('[data-filter-list]');
    if (!input || !list) return;
    input.hidden = false;
    input.addEventListener('input', () => {
      const query = input.value.trim().toLowerCase();
      for (const item of list.children) {
        item.hidden = query !== '' && !item.textContent.toLowerCase().includes(query);
      }
    });
  }

  function setupStatus() {
    const pill = document.querySelector('[data-status]');
    if (!pill) return;
    let wasBusy = pill.dataset.tone === 'busy';
    let timer;
    const schedule = (ms) => {
      clearTimeout(timer);
      if (!document.hidden) timer = setTimeout(tick, ms);
    };
    const tick = async () => {
      let delay = 15000;
      try {
        const response = await fetch(pill.dataset.status, {
          credentials: 'same-origin',
          headers: { Accept: 'application/json' },
        });
        if (response.ok) {
          const state = await response.json();
          pill.textContent =
            wasBusy && !state.busy && state.tone === 'ok' ? '사이트에 반영됐어요' : state.label;
          pill.dataset.tone = state.tone;
          pill.title = state.detail || '';
          wasBusy = state.busy;
          if (state.busy) delay = 2500;
        }
      } catch {
        // 잠시 끊김: 다음 차례에 다시 묻는다.
      }
      schedule(delay);
    };
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) schedule(0);
    });
    document.addEventListener('luna:jobs', () => schedule(500));
    schedule(wasBusy ? 2500 : 15000);
  }
})();
