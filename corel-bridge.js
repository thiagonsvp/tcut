(() => {
  const docker = new URLSearchParams(location.search).has('docker');
  if (docker) document.body.classList.add('docker-mode');
  const local = location.hostname === 'localhost' || location.hostname === '127.0.0.1';
  if (!local) return;

  document.querySelectorAll('.corel-control').forEach(button => button.classList.remove('hidden'));
  if (docker) {
    $('importButton').classList.add('hidden');
    $('lbImportButton').classList.add('hidden');
    $('ledImportButton').classList.add('hidden');
    document.querySelectorAll('[data-corel-receive]').forEach(button => { button.textContent = 'Usar seleção do Corel'; });
    document.querySelectorAll('[data-corel-send]').forEach(button => { button.textContent = 'Aplicar no Corel'; });
    const showSelectionHints = () => {
      $('fileName').textContent = 'Nenhuma seleção';
      $('fileSubtitle').textContent = 'Use a seleção do desenho';
      $('placedDetail').textContent = 'Aguardando seleção';
      $('settingsMessage').textContent = 'Selecione as peças no Corel e clique em Usar seleção do Corel.';
      $('lbFileName').textContent = 'Nenhuma seleção';
      $('lbFileDetail').textContent = 'Selecione letras fechadas no CorelDRAW.';
      $('lbMessage').textContent = 'Use a seleção do Corel para gerar as tiras.';
      $('lbResultsList').querySelector('p')?.replaceChildren('Use a seleção do Corel para listar as tiras.');
      $('ledFileName').textContent = 'Nenhuma seleção';
      $('ledFileDetail').textContent = 'Selecione letras ou objetos fechados no CorelDRAW.';
      $('ledMessage').textContent = 'Use a seleção do Corel para gerar o canal LED.';
      $('ledResultsList').querySelector('p')?.replaceChildren('Use a seleção do Corel para listar os percursos.');
      $('piecesList').querySelector('.pieces-empty')?.replaceChildren('As peças selecionadas aparecerão aqui.');
    };
    $('emptyState').querySelector('p').textContent = 'Selecione as peças no CorelDRAW e clique em Usar seleção do Corel.';
    showSelectionHints();
    const clearSource = () => {
      showSelectionHints();
      window.chrome?.webview?.postMessage('TCUT_CLEAR_SOURCE');
    };
    $('resetButton').addEventListener('click', clearSource);
    $('lbResetButton').addEventListener('click', clearSource);
    $('ledResetButton').addEventListener('click', clearSource);
  }

  async function receive(button) {
    button.disabled = true;
    try {
      const response = await fetch('/api/corel/input', { cache: 'no-store' });
      if (!response.ok) throw new Error(await response.text());
      const svg = await response.text();
      const led = !$('ledView').classList.contains('hidden');
      const letterbox = !$('letterboxView').classList.contains('hidden');
      const target = led ? window.TCutLedBridge : (letterbox ? window.TCutLetterboxBridge : window.TCutNestingBridge);
      await target.importSvg(svg, 'Seleção do CorelDRAW.svg');
      notify(led ? 'Seleção recebida e canal LED gerado.' : (letterbox ? 'Seleção recebida e tiras geradas.' : 'Seleção recebida e plano otimizado.'));
      return true;
    } catch (error) {
      notify(error.message || 'Falha ao receber a seleção do CorelDRAW.', true);
      return false;
    } finally {
      button.disabled = false;
    }
  }

  async function send(button) {
    button.disabled = true;
    try {
      const target = button.dataset.corelSend === 'led' ? window.TCutLedBridge : (button.dataset.corelSend === 'letterbox' ? window.TCutLetterboxBridge : window.TCutNestingBridge);
      const svg = target.exportSvg();
      const response = await fetch('/api/corel/output', {
        method: 'POST',
        headers: { 'Content-Type': 'image/svg+xml' },
        body: svg,
      });
      if (!response.ok) throw new Error(await response.text());
      notify(docker ? 'Aplicando o resultado no documento do CorelDRAW...' : 'SVG pronto. No CorelDRAW, execute “T-Cut - Importar resultado”.');
      return true;
    } catch (error) {
      notify(error.message || 'Falha ao enviar o resultado ao CorelDRAW.', true);
      return false;
    } finally {
      button.disabled = false;
    }
  }

  document.querySelectorAll('[data-corel-receive]').forEach(button => button.addEventListener('click', () => {
    if (docker) {
      if (window.chrome?.webview) window.chrome.webview.postMessage('TCUT_SEND');
      else notify('Abra o painel T-Cut dentro do CorelDRAW.', true);
    } else receive(button);
  }));
  document.querySelectorAll('[data-corel-send]').forEach(button => button.addEventListener('click', async () => {
    if (docker && !window.chrome?.webview) { notify('Abra o painel T-Cut dentro do CorelDRAW.', true); return; }
    const ok = await send(button);
    if (ok && docker && window.chrome?.webview)
      window.chrome.webview.postMessage(button.dataset.corelSend === 'led' ? 'TCUT_IMPORT_LED' : (button.dataset.corelSend === 'letterbox' ? 'TCUT_IMPORT_LETTERBOX' : 'TCUT_APPLY_NESTING'));
  }));
  window.TCutCorelBridge = {
    receiveCurrent() {
      const view = !$('ledView').classList.contains('hidden') ? $('ledView') : ($('letterboxView').classList.contains('hidden') ? $('nestingView') : $('letterboxView'));
      return receive(view.querySelector('[data-corel-receive]'));
    },
    sendCurrent() {
      const view = !$('ledView').classList.contains('hidden') ? $('ledView') : ($('letterboxView').classList.contains('hidden') ? $('nestingView') : $('letterboxView'));
      return send(view.querySelector('[data-corel-send]'));
    },
  };
})();
