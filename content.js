(() => {
  if (window.__shizhenContentLoaded) return;
  window.__shizhenContentLoaded = true;

  let layer = null;
  let selection = null;
  let dimension = null;
  let startPoint = null;
  let currentMetadata = null;
  let hoveredElement = null;
  let fullCaptureState = null;
  let editorDock = null;

  function isVisible(element) {
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden';
  }

  function scrollMetrics(element) {
    if (element === document.scrollingElement || element === document.documentElement || element === document.body) {
      const scrollingElement = document.scrollingElement || document.documentElement;
      return {
        target: scrollingElement,
        mode: 'window',
        scrollTop: window.scrollY,
        pageWidth: window.innerWidth,
        pageHeight: Math.max(scrollingElement.scrollHeight, document.documentElement.scrollHeight, document.body.scrollHeight),
        viewportWidth: window.innerWidth,
        viewportHeight: window.innerHeight,
        captureRect: { x: 0, y: 0, width: window.innerWidth, height: window.innerHeight }
      };
    }

    const rect = element.getBoundingClientRect();
    const left = Math.max(0, rect.left);
    const top = Math.max(0, rect.top);
    const right = Math.min(window.innerWidth, rect.right);
    const bottom = Math.min(window.innerHeight, rect.bottom);
    return {
      target: element,
      mode: 'element',
      scrollTop: element.scrollTop,
      pageWidth: element.clientWidth,
      pageHeight: element.scrollHeight,
      viewportWidth: Math.max(1, right - left),
      viewportHeight: Math.max(1, Math.min(element.clientHeight, bottom - top)),
      captureRect: {
        x: left,
        y: top,
        width: Math.max(1, right - left),
        height: Math.max(1, bottom - top)
      }
    };
  }

  function findPrimaryScrollTarget() {
    const root = document.scrollingElement || document.documentElement;
    const rootMetrics = scrollMetrics(root);
    const minimumWidth = Math.min(360, window.innerWidth * 0.36);
    const minimumHeight = Math.min(260, window.innerHeight * 0.36);
    const candidates = [...document.querySelectorAll('*')].filter((element) => {
      if (!isVisible(element)) return false;
      const style = getComputedStyle(element);
      if (!['auto', 'scroll'].includes(style.overflowY)) return false;
      if (element.scrollHeight <= element.clientHeight + 80) return false;
      const rect = element.getBoundingClientRect();
      return rect.width >= minimumWidth && rect.height >= minimumHeight;
    });

    let best = { element: root, score: Math.max(0, rootMetrics.pageHeight - rootMetrics.viewportHeight) * window.innerWidth };
    for (const element of candidates) {
      const rect = element.getBoundingClientRect();
      const scrollRange = element.scrollHeight - element.clientHeight;
      const visibleWidth = Math.max(0, Math.min(window.innerWidth, rect.right) - Math.max(0, rect.left));
      const visibleHeight = Math.max(0, Math.min(window.innerHeight, rect.bottom) - Math.max(0, rect.top));
      const visibleArea = visibleWidth * visibleHeight;
      const classHint = `${element.id} ${String(element.className)}`.toLowerCase();
      const semanticBoost = /(scroll|editor|doc|content|main|suite|render)/.test(classHint) ? 1.35 : 1;
      const score = scrollRange * Math.max(visibleArea, 1) * semanticBoost;
      if (score > best.score) best = { element, score };
    }
    return best.element;
  }

  function setScrollTop(target, mode, top) {
    if (mode === 'window') window.scrollTo(0, top);
    else target.scrollTo({ top, left: target.scrollLeft, behavior: 'auto' });
  }

  function nextFrame() {
    return new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  }

  function showPageToast(message) {
    document.querySelector('.shizhen-page-toast')?.remove();
    const toast = document.createElement('div');
    toast.className = 'shizhen-page-toast';
    toast.textContent = message;
    document.documentElement.appendChild(toast);
    setTimeout(() => toast.remove(), 2600);
  }

  function closeDock() {
    editorDock?.remove();
    editorDock = null;
  }

  function showDock(autosave = false) {
    closeDock();
    editorDock = document.createElement('iframe');
    editorDock.id = 'shizhen-editor-dock';
    editorDock.dataset.autosave = String(autosave);
    editorDock.setAttribute('allow', 'clipboard-write');
    editorDock.setAttribute('aria-label', autosave ? '正在自动保存截图' : '拾帧吸底式编辑器');
    const query = new URLSearchParams({ embedded: '1' });
    if (autosave) query.set('autosave', '1');
    editorDock.src = chrome.runtime.getURL(`editor-compact.html?${query.toString()}`);
    document.documentElement.appendChild(editorDock);
  }

  window.addEventListener('message', (event) => {
    if (event.data?.source !== 'shizhen-editor') return;
    if (event.data.type === 'close') closeDock();
    if (event.data.type === 'saved') {
      closeDock();
      showPageToast('截图已保存到拾帧素材库');
    }
    if (event.data.type === 'error') {
      closeDock();
      showPageToast(`截图保存失败：${event.data.message || '未知错误'}`);
    }
  });

  function suppressSmallWindowOverlays(scrollTarget, scrollMode) {
    if (scrollMode !== 'window') return [];
    const viewportArea = window.innerWidth * window.innerHeight;
    const hidden = [];
    for (const element of document.querySelectorAll('*')) {
      if (element === scrollTarget || element.contains(scrollTarget)) continue;
      const style = getComputedStyle(element);
      if (!['fixed', 'sticky'].includes(style.position)) continue;
      const rect = element.getBoundingClientRect();
      if (rect.width * rect.height > viewportArea * 0.32) continue;
      if (!isVisible(element)) continue;
      element.setAttribute('data-shizhen-hide-for-full', 'true');
      hidden.push(element);
    }
    return hidden;
  }

  function removeLayer() {
    layer?.remove();
    layer = null;
    selection = null;
    dimension = null;
    startPoint = null;
    hoveredElement = null;
  }

  function makeLayer(mode, tipText) {
    removeLayer();
    layer = document.createElement('div');
    layer.id = 'shizhen-capture-layer';
    layer.dataset.mode = mode;
    selection = document.createElement('div');
    selection.className = 'shizhen-selection-box';
    dimension = document.createElement('div');
    dimension.className = 'shizhen-dimension';
    dimension.hidden = true;
    const tip = document.createElement('div');
    tip.className = 'shizhen-capture-tip';
    tip.textContent = tipText;
    layer.append(selection, dimension, tip);
    document.documentElement.appendChild(layer);
    window.addEventListener('keydown', cancelOnEscape, true);
  }

  function cancelOnEscape(event) {
    if (event.key !== 'Escape') return;
    removeLayer();
    window.removeEventListener('keydown', cancelOnEscape, true);
  }

  function setSelection(rect) {
    selection.style.left = `${rect.x}px`;
    selection.style.top = `${rect.y}px`;
    selection.style.width = `${rect.width}px`;
    selection.style.height = `${rect.height}px`;
    dimension.hidden = false;
    dimension.textContent = `${Math.round(rect.width)} × ${Math.round(rect.height)}`;
    dimension.style.left = `${Math.max(8, rect.x)}px`;
    dimension.style.top = `${Math.max(8, rect.y + rect.height + 8)}px`;
  }

  async function submitRect(rect) {
    removeLayer();
    window.removeEventListener('keydown', cancelOnEscape, true);
    await chrome.runtime.sendMessage({
      type: 'SHIZHEN_CAPTURE_RECT',
      rect: { ...rect, dpr: window.devicePixelRatio },
      metadata: currentMetadata
    });
  }

  function startRegion(metadata) {
    currentMetadata = metadata;
    makeLayer('region', '拖动选择截图区域 · Esc 取消');

    layer.addEventListener('pointerdown', (event) => {
      if (event.button !== 0) return;
      startPoint = { x: event.clientX, y: event.clientY };
      layer.setPointerCapture(event.pointerId);
    });
    layer.addEventListener('pointermove', (event) => {
      if (!startPoint) return;
      const rect = {
        x: Math.min(startPoint.x, event.clientX),
        y: Math.min(startPoint.y, event.clientY),
        width: Math.abs(event.clientX - startPoint.x),
        height: Math.abs(event.clientY - startPoint.y)
      };
      setSelection(rect);
    });
    layer.addEventListener('pointerup', async (event) => {
      if (!startPoint) return;
      const rect = {
        x: Math.min(startPoint.x, event.clientX),
        y: Math.min(startPoint.y, event.clientY),
        width: Math.abs(event.clientX - startPoint.x),
        height: Math.abs(event.clientY - startPoint.y)
      };
      startPoint = null;
      if (rect.width < 8 || rect.height < 8) return;
      await submitRect(rect);
    });
  }

  function elementAtPointer(x, y) {
    layer.style.pointerEvents = 'none';
    const element = document.elementFromPoint(x, y);
    layer.style.pointerEvents = '';
    return element;
  }

  function startElement(metadata) {
    currentMetadata = metadata;
    makeLayer('element', '移动选择页面元素，单击截取 · Esc 取消');
    layer.addEventListener('pointermove', (event) => {
      const element = elementAtPointer(event.clientX, event.clientY);
      if (!element || element === hoveredElement) return;
      hoveredElement = element;
      const box = element.getBoundingClientRect();
      setSelection({ x: box.left, y: box.top, width: box.width, height: box.height });
    });
    layer.addEventListener('click', async (event) => {
      event.preventDefault();
      event.stopPropagation();
      const element = elementAtPointer(event.clientX, event.clientY);
      if (!element) return;
      const box = element.getBoundingClientRect();
      await submitRect({ x: box.left, y: box.top, width: box.width, height: box.height });
    }, true);
  }

  function prepareFullCapture() {
    const target = findPrimaryScrollTarget();
    const metrics = scrollMetrics(target);
    const hiddenElements = suppressSmallWindowOverlays(target, metrics.mode);
    fullCaptureState = {
      target,
      mode: metrics.mode,
      originalLeft: metrics.mode === 'window' ? window.scrollX : target.scrollLeft,
      originalTop: metrics.scrollTop,
      hiddenElements
    };
    setScrollTop(target, metrics.mode, 0);
    const isFeishu = /(^|\.)feishu\.cn$|(^|\.)larksuite\.com$/.test(location.hostname);
    return {
      pageWidth: metrics.pageWidth,
      pageHeight: metrics.pageHeight,
      viewportWidth: metrics.viewportWidth,
      viewportHeight: metrics.viewportHeight,
      captureRect: metrics.captureRect,
      scrollMode: metrics.mode,
      renderDelay: isFeishu ? 900 : 620,
      dpr: window.devicePixelRatio
    };
  }

  async function scrollFullTo(top) {
    if (!fullCaptureState) throw new Error('长截图会话已失效');
    setScrollTop(fullCaptureState.target, fullCaptureState.mode, top);
    await nextFrame();
    const metrics = scrollMetrics(fullCaptureState.target);
    return {
      scrollTop: metrics.scrollTop,
      pageHeight: metrics.pageHeight,
      viewportHeight: metrics.viewportHeight,
      captureRect: metrics.captureRect
    };
  }

  function finishFullCapture() {
    if (!fullCaptureState) return;
    fullCaptureState.hiddenElements.forEach((element) => element.removeAttribute('data-shizhen-hide-for-full'));
    setScrollTop(fullCaptureState.target, fullCaptureState.mode, fullCaptureState.originalTop);
    if (fullCaptureState.mode === 'window') window.scrollTo(fullCaptureState.originalLeft, fullCaptureState.originalTop);
    else fullCaptureState.target.scrollLeft = fullCaptureState.originalLeft;
    fullCaptureState = null;
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message.type === 'SHIZHEN_PING') {
      sendResponse({ ok: true });
      return;
    }
    if (message.type === 'SHIZHEN_SELECT_REGION') {
      startRegion(message.metadata);
      sendResponse({ ok: true });
      return;
    }
    if (message.type === 'SHIZHEN_SELECT_ELEMENT') {
      startElement(message.metadata);
      sendResponse({ ok: true });
      return;
    }
    if (message.type === 'SHIZHEN_PREPARE_FULL') {
      try {
        sendResponse({ ok: true, ...prepareFullCapture() });
      } catch (error) {
        sendResponse({ ok: false, error: error.message });
      }
      return;
    }
    if (message.type === 'SHIZHEN_SCROLL_FULL_TO') {
      scrollFullTo(message.top)
        .then((metrics) => sendResponse({ ok: true, ...metrics }))
        .catch((error) => sendResponse({ ok: false, error: error.message }));
      return true;
    }
    if (message.type === 'SHIZHEN_FINISH_FULL') {
      finishFullCapture();
      sendResponse({ ok: true });
      return;
    }
    if (message.type === 'SHIZHEN_SHOW_DOCKED_EDITOR') {
      showDock(false);
      sendResponse({ ok: true });
      return;
    }
    if (message.type === 'SHIZHEN_AUTOSAVE_CAPTURE') {
      showDock(true);
      sendResponse({ ok: true });
    }
  });
})();
