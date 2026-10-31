(function () {
  'use strict';

  var API_CATALOG = '/api/figures/catalog';
  var API_PREVIEW = '/api/figures/catalog/preview';
  var LIMIT = 1000;
  var ALL_STATUSES = [
    'k40_verified',
    'materialized',
    'blocked_dependency',
    'blocked_network',
    'blocked_code',
    'blocked_image',
    'blocked_timeout',
    'split_materialized',
    'split_code_ready',
    'generic_candidate',
    'code_ready',
    'needs_split',
    'image_missing',
    'local_image_missing',
    'code_missing'
  ];
  var PREVIEWABLE_STATUSES = new Set([
    'k40_verified', 'materialized', 'code_ready',
    'blocked_dependency', 'blocked_network', 'blocked_code',
    'blocked_image', 'blocked_timeout', 'split_materialized'
  ]);
  var STATUS_LABELS = {
    k40_verified: '已验证',
    materialized: '已物化',
    blocked_dependency: '缺依赖',
    blocked_network: '外网失败',
    blocked_code: '代码失败',
    blocked_image: '图片失败',
    blocked_timeout: '执行超时',
    split_materialized: '已拆分',
    split_code_ready: '拆分代码就绪',
    generic_candidate: '通用候选',
    code_ready: '代码就绪',
    needs_split: '待拆分',
    image_missing: '缺图',
    local_image_missing: '缺本地图',
    code_missing: '缺代码'
  };
  var STATUS_CLASSES = {
    k40_verified: 'verified',
    materialized: 'materialized',
    blocked_dependency: 'blocked',
    blocked_network: 'blocked',
    blocked_code: 'blocked',
    blocked_image: 'blocked',
    blocked_timeout: 'blocked',
    split_materialized: 'ready',
    split_code_ready: 'split',
    generic_candidate: 'missing',
    code_ready: 'ready',
    needs_split: 'split',
    image_missing: 'missing',
    local_image_missing: 'missing',
    code_missing: 'missing'
  };
  var ICONS = {
    image: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2"></rect><circle cx="8.5" cy="9.5" r="1.5"></circle><path d="m21 15-4.5-4.5L9 18"></path></svg>'
  };

  var state = {
    query: '',
    language: '',
    status: '',
    selectedId: null,
    entries: [],
    stats: {},
    catalogErrors: [],
    loading: false,
    requestSeq: 0,
    controller: null
  };
  var lastDetailTrigger = null;

  var $ = function (id) {
    return document.getElementById(id);
  };

  function debounce(fn, wait) {
    var timer = null;
    return function () {
      var args = arguments;
      clearTimeout(timer);
      timer = setTimeout(function () {
        fn.apply(null, args);
      }, wait);
    };
  }

  function statusLabel(status) {
    return STATUS_LABELS[status] || status || '未标注';
  }

  function statusClass(status) {
    return STATUS_CLASSES[status] || 'missing';
  }

  function hasPreview(entry) {
    return Boolean(entry && entry.preview_path && PREVIEWABLE_STATUSES.has(entry.status));
  }

  function previewUrl(catalogId) {
    return API_PREVIEW + '?id=' + encodeURIComponent(catalogId);
  }

  function splitList(value, separator) {
    return String(value || '')
      .split(separator || /[,|]/)
      .map(function (item) { return item.trim(); })
      .filter(Boolean);
  }

  function formatScore(value) {
    var number = Number(value);
    return Number.isFinite(number) ? number.toFixed(1) : '未记录';
  }

  function formatDimensions(entry) {
    if (!entry || !entry.width || !entry.height) return '未记录';
    return String(entry.width) + ' x ' + String(entry.height) + ' px';
  }

  function safePageUrl(value) {
    try {
      var url = new URL(String(value || ''));
      return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : null;
    } catch (error) {
      return null;
    }
  }

  function createElement(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = String(text);
    return node;
  }

  function appendChip(parent, text) {
    parent.appendChild(createElement('span', 'chip', text));
  }

  function appendPlaceholder(parent, message) {
    var wrapper = createElement('span', 'preview-placeholder');
    wrapper.innerHTML = ICONS.image;
    wrapper.appendChild(createElement('span', '', message));
    parent.appendChild(wrapper);
  }

  function appendPreviewImage(parent, entry, lazy) {
    var image = document.createElement('img');
    image.src = previewUrl(entry.catalog_id);
    image.alt = '候选图：' + (entry.title || entry.catalog_id);
    image.decoding = 'async';
    if (lazy) image.loading = 'lazy';
    image.addEventListener('error', function () {
      image.remove();
      appendPlaceholder(parent, '预览读取失败，请查看状态与来源。');
    }, { once: true });
    parent.appendChild(image);
  }

  function appendStatusBadge(parent, status) {
    var badge = createElement('span', 'status-badge ' + statusClass(status), statusLabel(status));
    parent.appendChild(badge);
  }

  function updateUrl() {
    var params = new URLSearchParams();
    if (state.query) params.set('q', state.query);
    if (state.language) params.set('language', state.language);
    if (state.status) params.set('status', state.status);
    if (state.selectedId) params.set('id', state.selectedId);
    var next = location.pathname + (params.toString() ? '?' + params.toString() : '');
    try {
      history.replaceState(null, '', next);
    } catch (error) {
      // A local file preview may not allow history replacement.
    }
  }

  function buildApiUrl(status) {
    var params = new URLSearchParams();
    if (state.query) params.set('q', state.query);
    if (state.language) params.set('language', state.language);
    if (status) params.set('status', status);
    params.set('limit', String(LIMIT));
    return API_CATALOG + '?' + params.toString();
  }

  function uniqueEntries(entries) {
    var seen = new Set();
    return entries.filter(function (entry) {
      if (!entry || !entry.catalog_id || seen.has(entry.catalog_id)) return false;
      seen.add(entry.catalog_id);
      return true;
    });
  }

  function updateFilterCounts() {
    var statusSelect = $('status');
    Array.prototype.forEach.call(statusSelect.options, function (option) {
      if (!option.value) {
        option.textContent = '全部状态';
        return;
      }
      var count = Number(state.stats[option.value] || 0);
      option.textContent = statusLabel(option.value) + ' (' + count + ')';
    });
  }

  function setLoading(isLoading) {
    state.loading = isLoading;
    $('loading-grid').hidden = !isLoading;
    if (isLoading) {
      $('figure-grid').hidden = true;
      $('empty-state').hidden = true;
      $('error-state').hidden = true;
      $('loading-grid').replaceChildren();
      for (var i = 0; i < 6; i += 1) {
        var skeleton = createElement('div', 'skeleton-card');
        skeleton.setAttribute('aria-hidden', 'true');
        $('loading-grid').appendChild(skeleton);
      }
      $('results-summary').textContent = '正在读取候选图库';
    }
  }

  function renderAlert() {
    var alert = $('catalog-alert');
    var errors = state.catalogErrors || [];
    if (!errors.length) {
      alert.hidden = true;
      alert.textContent = '';
      return;
    }
    var visible = errors.slice(0, 4);
    var suffix = errors.length > visible.length
      ? '，另有 ' + (errors.length - visible.length) + ' 项'
      : '';
    alert.textContent = '目录校验提示：' + visible.join('；') + suffix;
    alert.hidden = false;
  }

  function renderError(message) {
    $('loading-grid').hidden = true;
    $('figure-grid').hidden = true;
    $('empty-state').hidden = true;
    $('error-state').hidden = false;
    $('error-message').textContent = message || '请检查服务是否可用。';
    $('results-summary').textContent = '读取失败';
    $('header-count').textContent = '读取失败';
    clearDetail();
  }

  function renderEmpty() {
    $('loading-grid').hidden = true;
    $('figure-grid').hidden = true;
    $('error-state').hidden = true;
    $('empty-state').hidden = false;
    $('results-summary').textContent = '0 个候选';
    $('header-count').textContent = '0 个结果';
    clearDetail();
  }

  function renderCard(entry) {
    var article = createElement('article', 'figure-card');
    if (entry.catalog_id === state.selectedId) article.classList.add('is-selected');

    var button = createElement('button', 'figure-card-button');
    button.type = 'button';
    button.dataset.catalogId = entry.catalog_id;
    button.setAttribute('aria-label', '查看候选图：' + (entry.title || entry.catalog_id));

    var preview = createElement('span', 'card-preview');
    if (hasPreview(entry)) {
      appendPreviewImage(preview, entry, true);
    } else {
      appendPlaceholder(preview, '单图预览待补齐');
    }
    appendStatusBadge(preview, entry.status);

    var body = createElement('span', 'card-body');
    body.appendChild(createElement('span', 'card-title', entry.title || '未命名候选图'));

    var meta = createElement('span', 'card-meta');
    meta.appendChild(createElement('span', 'lang-pill', entry.lang || '未标注'));
    meta.appendChild(createElement('span', 'card-type', entry.chart_type || '未标注'));
    body.appendChild(meta);

    var footer = createElement('span', 'card-footer');
    footer.appendChild(createElement('span', 'bio-level', entry.bio_level || '未标注'));
    footer.appendChild(createElement('span', 'card-score', '评分 ' + formatScore(entry.score)));
    body.appendChild(footer);

    button.appendChild(preview);
    button.appendChild(body);
    button.addEventListener('click', function () {
      selectEntry(entry.catalog_id, button);
    });
    article.appendChild(button);
    return article;
  }

  function renderCards() {
    var grid = $('figure-grid');
    grid.replaceChildren();
    state.entries.forEach(function (entry) {
      grid.appendChild(renderCard(entry));
    });
  }

  function setDetailBadges(entry) {
    var container = $('detail-badges');
    container.replaceChildren();
    appendStatusBadge(container, entry.status);
    if (entry.pilot) {
      container.appendChild(createElement('span', 'detail-badge', '试点条目'));
    }
    container.appendChild(createElement('span', 'detail-badge', entry.lang || '未标注'));
    if (entry.bio_level) {
      container.appendChild(createElement('span', 'detail-badge', entry.bio_level));
    }
  }

  function setDetailFacts(entry) {
    var facts = [
      ['目录 ID', entry.catalog_id || '未记录'],
      ['语言', entry.lang || '未记录'],
      ['图型', entry.chart_type || '未标注'],
      ['族', entry.family || '未标注'],
      ['生信强度', entry.bio_level || '未标注'],
      ['评分', formatScore(entry.score)],
      ['尺寸', formatDimensions(entry)],
      ['代码路径', entry.code_path || '尚未物化']
    ];
    var list = $('detail-facts');
    list.replaceChildren();
    facts.forEach(function (fact) {
      list.appendChild(createElement('dt', '', fact[0]));
      var value = createElement('dd', '', fact[1]);
      if (fact[0] === '代码路径' && entry.code_path) {
        value.replaceChildren();
        value.appendChild(createElement('code', '', entry.code_path));
      }
      list.appendChild(value);
    });
  }

  function setDetailDependencies(entry) {
    var container = $('detail-deps');
    container.replaceChildren();
    var dependencies = splitList(entry.deps, /[,|]/);
    if (!dependencies.length) {
      appendChip(container, '未记录');
      return;
    }
    dependencies.forEach(function (dependency) {
      appendChip(container, dependency);
    });
  }

  function setDetailBioTags(entry) {
    var container = $('detail-bio-tags');
    container.replaceChildren();
    var tags = splitList(entry.bio_tags, /\|/);
    if (!tags.length) {
      appendChip(container, '未记录');
      return;
    }
    tags.forEach(function (tag) {
      appendChip(container, tag);
    });
  }

  function setDetailSource(entry) {
    var link = $('detail-page-link');
    var host = $('detail-source-host');
    var url = safePageUrl(entry.page_url);
    if (!url) {
      link.href = '#';
      link.removeAttribute('target');
      link.setAttribute('tabindex', '-1');
      link.setAttribute('aria-disabled', 'true');
      link.textContent = '来源页未记录';
      host.textContent = '';
      return;
    }
    link.href = url;
    link.setAttribute('target', '_blank');
    link.setAttribute('rel', 'noreferrer');
    link.removeAttribute('tabindex');
    link.removeAttribute('aria-disabled');
    link.replaceChildren();
    link.appendChild(createElement('span', '', '打开来源页'));
    link.insertAdjacentHTML('beforeend', '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 4h6v6"></path><path d="m20 4-9 9"></path><path d="M20 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h5"></path></svg>');
    try {
      host.textContent = new URL(url).hostname;
    } catch (error) {
      host.textContent = url;
    }
  }

  function renderDetail(entry) {
    var empty = $('detail-empty');
    var content = $('detail-content');
    if (!entry) {
      empty.hidden = false;
      content.hidden = true;
      return;
    }

    empty.hidden = true;
    content.hidden = false;
    $('detail-heading').textContent = entry.title || '未命名候选图';

    var preview = $('detail-preview');
    preview.replaceChildren();
    if (hasPreview(entry)) {
      appendPreviewImage(preview, entry, false);
    } else {
      appendPlaceholder(preview, '该条目尚未物化为单图，预览待补齐。');
    }

    setDetailBadges(entry);

    var note = $('detail-note');
    if (!hasPreview(entry)) {
      note.textContent = '当前状态为「' + statusLabel(entry.status) + '」，单图预览和可执行代码路径尚未完成物化。';
      note.hidden = false;
    } else {
      note.hidden = true;
      note.textContent = '';
    }

    setDetailFacts(entry);
    setDetailDependencies(entry);
    setDetailBioTags(entry);
    setDetailSource(entry);
    $('detail-code-path').textContent = entry.code_path || '尚未物化';
    $('detail-template-id').textContent = entry.suggested_template_id
      ? '建议模板：' + entry.suggested_template_id
      : '建议模板：未记录';
  }

  function clearDetail() {
    state.selectedId = null;
    renderDetail(null);
    updateUrl();
  }

  function selectEntry(catalogId, trigger) {
    state.selectedId = catalogId;
    var selected = state.entries.find(function (entry) {
      return entry.catalog_id === catalogId;
    });
    if (!selected) return;
    lastDetailTrigger = trigger || null;

    Array.prototype.forEach.call(document.querySelectorAll('.figure-card'), function (card) {
      var button = card.querySelector('.figure-card-button');
      card.classList.toggle('is-selected', Boolean(button && button.dataset.catalogId === catalogId));
    });

    renderDetail(selected);
    updateUrl();
    openDetailOnMobile();
  }

  function openDetailOnMobile() {
    if (!window.matchMedia('(max-width: 860px)').matches) return;
    var panel = $('detail-panel');
    panel.classList.add('is-open');
    panel.setAttribute('aria-hidden', 'false');
    panel.inert = false;
    $('detail-backdrop').hidden = false;
    document.body.classList.add('drawer-open');
    var close = $('detail-close');
    if (close) close.focus({ preventScroll: true });
  }

  function closeDetail() {
    var panel = $('detail-panel');
    panel.classList.remove('is-open');
    panel.setAttribute('aria-hidden', 'true');
    panel.inert = true;
    $('detail-backdrop').hidden = true;
    document.body.classList.remove('drawer-open');
    if (lastDetailTrigger && document.contains(lastDetailTrigger)) {
      lastDetailTrigger.focus({ preventScroll: true });
    }
  }

  function syncDetailMode() {
    var panel = $('detail-panel');
    if (window.matchMedia('(max-width: 860px)').matches) {
      if (!panel.classList.contains('is-open')) {
        panel.setAttribute('aria-hidden', 'true');
        panel.inert = true;
        $('detail-backdrop').hidden = true;
        document.body.classList.remove('drawer-open');
      }
    } else {
      panel.classList.remove('is-open');
      panel.setAttribute('aria-hidden', 'false');
      panel.inert = false;
      $('detail-backdrop').hidden = true;
      document.body.classList.remove('drawer-open');
    }
  }

  function render() {
    updateFilterCounts();
    renderAlert();
    $('figure-grid').hidden = false;
    $('error-state').hidden = true;
    $('empty-state').hidden = state.entries.length > 0;
    $('figure-grid').replaceChildren();

    if (!state.entries.length) {
      renderEmpty();
      return;
    }

    if (!state.entries.some(function (entry) { return entry.catalog_id === state.selectedId; })) {
      state.selectedId = state.entries[0].catalog_id;
    }

    renderCards();
    var selected = state.entries.find(function (entry) {
      return entry.catalog_id === state.selectedId;
    });
    renderDetail(selected || state.entries[0]);
    $('results-summary').textContent = '显示 ' + state.entries.length + ' 个候选';
    $('header-count').textContent = state.entries.length + ' 个结果';
    updateUrl();
  }

  async function fetchCatalog() {
    var sequence = state.requestSeq + 1;
    state.requestSeq = sequence;
    if (state.controller) state.controller.abort();
    state.controller = new AbortController();
    setLoading(true);
    renderAlert();

    var statuses = state.status ? [state.status] : ALL_STATUSES;
    try {
      var bodies = await Promise.all(statuses.map(async function (status) {
        var response = await fetch(buildApiUrl(status), {
          headers: { Accept: 'application/json' },
          signal: state.controller.signal
        });
        if (!response.ok) {
          throw new Error('请求失败，HTTP ' + response.status);
        }
        return response.json();
      }));

      if (sequence !== state.requestSeq) return;

      state.entries = uniqueEntries(bodies.reduce(function (all, body) {
        return all.concat(Array.isArray(body.entries) ? body.entries : []);
      }, []));
      state.stats = bodies[0] && bodies[0].stats ? bodies[0].stats : {};
      state.catalogErrors = [];
      bodies.forEach(function (body) {
        if (body.ok === false && !(body.catalog_errors || []).length) {
          if (!state.catalogErrors.includes('目录校验未通过')) {
            state.catalogErrors.push('目录校验未通过');
          }
        }
        (body.catalog_errors || []).forEach(function (error) {
          if (!state.catalogErrors.includes(error)) state.catalogErrors.push(error);
        });
      });
      render();
    } catch (error) {
      if (error.name === 'AbortError' || sequence !== state.requestSeq) return;
      renderError(error.message || '请检查服务是否可用。');
    } finally {
      if (sequence === state.requestSeq) {
        setLoading(false);
        if (state.entries.length) {
          $('figure-grid').hidden = false;
          $('loading-grid').hidden = true;
        }
      }
    }
  }

  function readInitialState() {
    var params = new URLSearchParams(location.search);
    state.query = params.get('q') || '';
    state.language = params.get('language') || '';
    state.status = params.get('status') || '';
    state.selectedId = params.get('id') || null;
    $('query').value = state.query;
    $('language').value = state.language;
    $('status').value = state.status;
  }

  function resetFilters() {
    state.query = '';
    state.language = '';
    state.status = '';
    state.selectedId = null;
    $('query').value = '';
    $('language').value = '';
    $('status').value = '';
    fetchCatalog();
  }

  function bindEvents() {
    var debouncedSearch = debounce(function () {
      state.query = $('query').value.trim();
      fetchCatalog();
    }, 180);

    $('query').addEventListener('input', debouncedSearch);
    $('language').addEventListener('change', function () {
      state.language = $('language').value;
      fetchCatalog();
    });
    $('status').addEventListener('change', function () {
      state.status = $('status').value;
      fetchCatalog();
    });
    $('filter-form').addEventListener('submit', function (event) {
      event.preventDefault();
      state.query = $('query').value.trim();
      fetchCatalog();
    });
    $('reset-filters').addEventListener('click', resetFilters);
    $('retry-button').addEventListener('click', fetchCatalog);
    $('detail-close').addEventListener('click', closeDetail);
    $('detail-backdrop').addEventListener('click', closeDetail);
    document.addEventListener('keydown', function (event) {
      if (event.key === 'Escape' && $('detail-panel').classList.contains('is-open')) {
        closeDetail();
      }
    });
    window.addEventListener('resize', syncDetailMode);
  }

  readInitialState();
  bindEvents();
  syncDetailMode();
  fetchCatalog();
})();
