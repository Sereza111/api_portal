'use strict';

/* =========================================================
 * api-portal API portal — frontend logic
 * ========================================================= */

(function () {
  const $ = (s) => document.querySelector(s);
  const SESSION_KEY = 'cx_key';
  const LANG_KEY = 'cx_lang';
  const OS_KEY = 'cx_os';
  const UNIT_KEY = 'cx_usage_unit';
  const NEWS_CLOSED_KEY = 'cx_news_closed_id';

  // Tabs whose commands genuinely differ per OS. Everything else (Python, Node,
  // the GUI clients) is identical everywhere, and showing an OS switch there
  // would imply a difference that does not exist.
  const OS_TABS = ['curl', 'grok', 'claude', 'codex', 'aider', 'continue'];

  // The server derives this from PUBLIC_ORIGIN. Keep the current origin as a
  // usable fallback when the configuration endpoint is temporarily unavailable.
  let BASE_URL = `${window.location.origin}/v1`;
  let PUBLIC_URL = window.location.origin;
  let STATUS_URL = `${window.location.origin}/status`;
  let PORTAL_NAME = 'API PORTAL';

  async function loadConfig() {
    try {
      const r = await fetch('/api/config');
      if (!r.ok) return;
      const config = await r.json();
      if (typeof config.base_url === 'string' && config.base_url) {
        BASE_URL = config.base_url;
      }
      if (typeof config.public_url === 'string' && config.public_url) PUBLIC_URL = config.public_url;
      if (typeof config.status_url === 'string' && config.status_url) STATUS_URL = config.status_url;
      if (typeof config.portal_name === 'string' && config.portal_name) PORTAL_NAME = config.portal_name;
      const statusLink = $('#statusLink');
      if (statusLink) statusLink.href = STATUS_URL;
      document.querySelectorAll('[data-brand]').forEach((el) => { el.textContent = PORTAL_NAME; });
    } catch (_) {
      // The fallback above keeps the portal usable during a transient failure.
    }
  }

  // ---------------- i18n ----------------
  const I18N = {
    ru: {
      'page.title': 'Портал клиента',
      'hero.badge': 'Портал по API-ключу',
      'hero.title': 'Ваш ключ. Ваш доступ. Один портал.',
      'hero.subtitle': 'Баланс, фактическое потребление, доступные модели и готовые конфигурации клиентов.',
      'hero.oneClick': '1 клик',
      'hero.copyConfig': 'копировать конфиг',
      'login.title': 'Вход для клиента',
      'login.subtitle': 'Вход по вашему API-ключу',
      'login.button': 'Войти',
      'login.disclaimer': 'Не передавайте свой API-ключ. Он нужен для входа и вызовов API.',
      'dash.copyConfig': 'Копировать конфиг',
      'dash.logout': 'Выйти',
      'dash.remaining': 'Остаток кредитов',
      'dash.ofPackage': 'из —',
      'dash.used': 'Списано',
      'dash.usedSub': 'всего израсходовано кредитов',
      'dash.plan': 'Тариф',
      'dash.noExpiry': 'действует до тех пор, пока вы не потратите все свои кредиты',
      'dash.connect': 'Подключение API',
      'dash.copy': 'Копировать',
      'dash.compatNote': 'OpenAI-совместимо — подставьте Base URL и свой ключ в любой OpenAI-клиент или SDK. Доступные модели — в разделе выше.',
      'dash.modelsTitle': 'Модели',
      'dash.modelsNote': 'Кредиты за 1 млн токенов: вход / выход. Справа — доступность модели: задержка и успешность считаются по реальному трафику.',
      'status.operational': 'Все модели работают',
      'status.partial': 'Частичные перебои',
      'status.outage': 'Модели недоступны',
      'status.unknown': 'Нет данных',
      'status.available': 'Работает',
      'status.degraded': 'Сбои',
      'status.down': 'Не отвечает',
      'dash.longCtx': 'Цена ×{x} для запросов длиннее {n} токенов',
      'plan.nolimit': 'Ключ без срока',
      'dash.osHint': 'Команды зависят от системы — выберите свою',
      'dash.statusLink': 'Статус сервиса',
      'dash.spentTokens': 'израсходовано {n} токенов',
      'dash.spentTokensCached': 'израсходовано {n} токенов, из кэша {c}',
      'dash.requests': 'Запросы в журнале',
      'dash.totalCalls': 'всего вызовов',
      'dash.success': 'Успешность',
      'dash.recentReqs': 'от недавних запросов',
      'dash.availableModels': 'Доступные модели',
      'dash.tokens14': 'Расход — за 14 дней',
      'dash.byModel': 'По моделям',
      'dash.analytics': 'Потребление',
      'dash.unitLabel': 'Показывать',
      'dash.unitCredits': 'Кредиты',
      'dash.unitTokens': 'Токены',
      'sync.live': 'Синхронизировано {time}',
      'sync.cached': 'Последний снимок · {time}',
      'sync.stale': 'Данные журнала временно устарели',
      'sync.unavailable': 'Журнал New API временно недоступен — нули не подставлены',
      'dash.recent': 'Недавние запросы',
      'dash.t.time': 'Время',
      'dash.t.model': 'Модель',
      'dash.t.input': 'Вход, токены',
      'dash.t.output': 'Выход, токены',
      'dash.t.cache': 'Кэш, токены',
      'dash.t.credits': 'Кредиты',
      'dash.t.status': 'Статус',
      'err.empty': 'Введите API-ключ.',
      'err.invalid': 'Неверный или неактивный API-ключ.',
      'err.network': 'Не удалось связаться с сервером. Попробуйте позже.',
      'err.rateLimited': 'Слишком много запросов. Подождите минуту и попробуйте снова.',
      'err.rateLimitedWait': 'Слишком много запросов. Повтор через {s} с…',
      'err.upstream': 'Провайдер временно недоступен. Ключ в порядке, попробуйте позже.',
      'copy.done': 'Скопировано!',
      'expires.prefix': 'до ',
      'daily': ' в сутки',
      'package': ' в пакете',
      'perCall': 'за вызов',
      'perM': 'за 1M',
      'credits': 'кредитов',
      'noData': 'нет данных',
      'noRequests': 'запросов нет',
      'noModels': '(нет доступных моделей)',
      'status.ok': '✓ OK',
      'status.fail': '✕ сбой',
      'held': 'в работе',
      'heldSuffix': ' — вернутся, если запрос не выполнится',
      'requests': 'запр.',
    },
    en: {
      'page.title': 'Customer portal',
      'hero.badge': 'Portal by API-key',
      'hero.title': 'Your key. Your access. One portal.',
      'hero.subtitle': 'Balance, measured usage, available models, and ready-to-use client configurations.',
      'hero.oneClick': '1 click',
      'hero.copyConfig': 'copy config',
      'login.title': 'Sign in',
      'login.subtitle': 'Login with your API key',
      'login.button': 'Sign in',
      'login.disclaimer': 'Do not share your API key. It is used for login and API calls.',
      'dash.copyConfig': 'Copy config',
      'dash.logout': 'Logout',
      'dash.remaining': 'Credit balance',
      'dash.ofPackage': 'of —',
      'dash.used': 'Spent',
      'dash.usedSub': 'total credits spent',
      'dash.plan': 'Plan',
      'dash.noExpiry': 'valid until you spend all your credits',
      'dash.connect': 'API connection',
      'dash.copy': 'Copy',
      'dash.compatNote': 'OpenAI-compatible — set Base URL and your key in any OpenAI client or SDK. Available models are listed above.',
      'dash.modelsTitle': 'Models',
      'dash.modelsNote': 'Credits per 1M tokens: input / output. On the right — live availability: latency and success rate are measured on real traffic.',
      'status.operational': 'All models operational',
      'status.partial': 'Partial outage',
      'status.outage': 'Models unavailable',
      'status.unknown': 'No data',
      'status.available': 'Operational',
      'status.degraded': 'Degraded',
      'status.down': 'Not responding',
      'dash.longCtx': 'Price ×{x} for requests longer than {n} tokens',
      'plan.nolimit': 'Key with no expiry',
      'dash.osHint': 'Commands differ per OS — pick yours',
      'dash.statusLink': 'Service status',
      'dash.spentTokens': '{n} tokens spent',
      'dash.spentTokensCached': '{n} tokens spent, {c} from cache',
      'dash.requests': 'Requests in log',
      'dash.totalCalls': 'total calls',
      'dash.success': 'Success',
      'dash.recentReqs': 'of recent requests',
      'dash.availableModels': 'Available models',
      'dash.tokens14': 'Usage — last 14 days',
      'dash.byModel': 'By model',
      'dash.analytics': 'Usage',
      'dash.unitLabel': 'Display',
      'dash.unitCredits': 'Credits',
      'dash.unitTokens': 'Tokens',
      'sync.live': 'Synced {time}',
      'sync.cached': 'Last snapshot · {time}',
      'sync.stale': 'Request log data is temporarily stale',
      'sync.unavailable': 'New API log is temporarily unavailable — no zero values were substituted',
      'dash.recent': 'Recent requests',
      'dash.t.time': 'Time',
      'dash.t.model': 'Model',
      'dash.t.input': 'Input, tokens',
      'dash.t.output': 'Output, tokens',
      'dash.t.cache': 'Cache, tokens',
      'dash.t.credits': 'Credits',
      'dash.t.status': 'Status',
      'noRequests': 'no requests',
      'err.empty': 'Enter your API key.',
      'err.invalid': 'Invalid or inactive API key.',
      'err.network': 'Could not reach the server. Try again later.',
      'err.rateLimited': 'Too many requests. Wait a minute and try again.',
      'err.rateLimitedWait': 'Too many requests. Retrying in {s}s…',
      'err.upstream': 'Provider temporarily unavailable. Your key is fine, try again later.',
      'copy.done': 'Copied!',
      'expires.prefix': 'until ',
      'daily': ' per day',
      'package': ' in package',
      'perCall': 'per call',
      'perM': 'per 1M',
      'credits': 'credits',
      'noData': 'no data',
      'noModels': '(no models available)',
      'status.ok': '✓ OK',
      'status.fail': '✕ failed',
      'held': 'in flight',
      'heldSuffix': ' — returned if the request does not complete',
      'requests': 'reqs',
    },
  };

  // Определяем язык по цепочке приоритетов:
  //   1. сохранённый выбор пользователя (localStorage)
  //   2. navigator.languages (массив предпочтений браузера, как Accept-Language)
  //   3. navigator.language (fallback)
  //   4. 'ru' по умолчанию
  function detectBrowserLang() {
    const langs = (navigator.languages && navigator.languages.length ? navigator.languages : [navigator.language || '']);
    for (const l of langs) {
      if (!l) continue;
      const low = l.toLowerCase();
      if (low.startsWith('ru')) return 'ru';
      if (low.startsWith('en')) return 'en';
    }
    return 'ru';
  }
  function getLang() {
    const saved = localStorage.getItem(LANG_KEY);
    if (saved === 'ru' || saved === 'en') return saved;
    return detectBrowserLang();
  }
  function setLang(lang) {
    localStorage.setItem(LANG_KEY, lang);
    applyI18n(lang);
    document.documentElement.lang = lang;
    syncLangToggle(lang);
    // перерисуем дашборд если есть данные
    if (window._lastData) render(window._lastData, window._lastKey, { silent: true, refreshRemote: false });
  }
  function syncLangToggle(lang) {
    document.querySelectorAll('[data-lang-btn]').forEach((b) => {
      const active = b.getAttribute('data-lang-btn') === lang;
      b.classList.toggle('active', active);
      b.setAttribute('aria-pressed', active ? 'true' : 'false');
    });
  }
  function t(key) {
    const lang = getLang();
    return (I18N[lang] && I18N[lang][key]) || (I18N.ru[key]) || key;
  }

  function getUnit() {
    return localStorage.getItem(UNIT_KEY) === 'tokens' ? 'tokens' : 'credits';
  }

  function syncUnitToggle() {
    const unit = getUnit();
    document.querySelectorAll('[data-unit-btn]').forEach((button) => {
      button.setAttribute('aria-pressed', button.getAttribute('data-unit-btn') === unit ? 'true' : 'false');
    });
  }

  function setUnit(unit) {
    localStorage.setItem(UNIT_KEY, unit === 'tokens' ? 'tokens' : 'credits');
    syncUnitToggle();
    renderAnalytics();
  }

  // ---------------- OS variants ----------------
  /**
   * Which OS the copy-paste blocks are written for.
   *
   * navigator.platform is deprecated but still the most reliable hint in every
   * browser we care about; userAgentData is used first where present. A wrong
   * guess is harmless because the switch is right above the block.
   */
  function detectOs() {
    const ua = navigator.userAgentData;
    const raw = (ua && ua.platform) || navigator.platform || navigator.userAgent || '';
    const s = String(raw).toLowerCase();
    if (s.indexOf('win') !== -1) return 'win';
    if (s.indexOf('mac') !== -1 || s.indexOf('iphone') !== -1 || s.indexOf('ipad') !== -1) return 'mac';
    return 'linux';
  }
  function getOs() {
    const saved = localStorage.getItem(OS_KEY);
    if (saved === 'win' || saved === 'mac' || saved === 'linux') return saved;
    return detectOs();
  }
  function setOs(os) {
    localStorage.setItem(OS_KEY, os);
    syncOsToggle(os);
    applyOsVisibility();
    // Snippets are built as strings, so they must be regenerated, not just shown.
    refreshSnips();
  }
  function syncOsToggle(os) {
    document.querySelectorAll('[data-os-btn]').forEach((b) => {
      const active = b.getAttribute('data-os-btn') === os;
      b.classList.toggle('active', active);
      b.setAttribute('aria-pressed', active ? 'true' : 'false');
    });
  }
  /** Shows the guide blocks tagged for the current OS, hides the rest. */
  function applyOsVisibility() {
    const os = getOs();
    document.querySelectorAll('[data-os]').forEach((el) => {
      const list = (el.getAttribute('data-os') || '').split(/\s+/).filter(Boolean);
      el.hidden = list.length > 0 && list.indexOf(os) === -1;
    });
  }
  /** The OS switch is only meaningful on tabs whose commands actually differ. */
  function syncOsRow(tabName) {
    const row = $('#osRow');
    if (row) row.hidden = OS_TABS.indexOf(tabName) === -1;
  }

  /**
   * Rebuilds the code-tab snippets for the current OS.
   *
   * Only cURL differs: Linux/macOS take the POSIX form (backslash continuation,
   * single-quoted JSON), Windows cannot. Verified on PowerShell 5.1 and cmd.exe:
   *   - single-quoted JSON  -> upstream 400, PowerShell strips the quotes
   *   - bare `curl`         -> alias for Invoke-WebRequest, different CLI entirely
   *   - `curl.exe` + \" escaping and caret/backtick continuation -> 200
   * Python/Node/.env are byte-identical everywhere, so they are built once.
   */
  function refreshSnips() {
    const base = BASE_URL;
    const key = window._lastKey || '';
    const sm = sampleModel();
    const os = getOs();

    const curlPosix =
      `curl ${base}/chat/completions \\\n` +
      `  -H "Authorization: Bearer ${key}" \\\n` +
      `  -H "Content-Type: application/json" \\\n` +
      `  -d '{"model":"${sm}","messages":[{"role":"user","content":"Hello!"}]}'`;

    // PowerShell: `curl` is an alias for Invoke-WebRequest, so the binary must be
    // called as curl.exe; the JSON body needs \" escaping and ` continues lines.
    const curlWin =
      `curl.exe ${base}/chat/completions \`\n` +
      `  -H "Authorization: Bearer ${key}" \`\n` +
      `  -H "Content-Type: application/json" \`\n` +
      `  -d "{\\"model\\":\\"${sm}\\",\\"messages\\":[{\\"role\\":\\"user\\",\\"content\\":\\"Hello!\\"}]}"`;

    window._snips = {
      curl: os === 'win' ? curlWin : curlPosix,
      py:
        `from openai import OpenAI\n` +
        `client = OpenAI(api_key="${key}", base_url="${base}")\n` +
        `r = client.chat.completions.create(\n` +
        `    model="${sm}",\n` +
        `    messages=[{"role": "user", "content": "Hello!"}],\n` +
        `)\n` +
        `print(r.choices[0].message.content)`,
      js:
        `import OpenAI from "openai";\n` +
        `const client = new OpenAI({ apiKey: "${key}", baseURL: "${base}" });\n` +
        `const r = await client.chat.completions.create({\n` +
        `  model: "${sm}",\n` +
        `  messages: [{ role: "user", content: "Hello!" }],\n` +
        `});\n` +
        `console.log(r.choices[0].message.content);`,
      env: `OPENAI_API_KEY=${key}\nOPENAI_BASE_URL=${base}`,
    };

    // Repaint the visible snippet if a code tab is active.
    const activeTab = document.querySelector('.tab.active');
    const name = (activeTab && activeTab.getAttribute('data-tab')) || '';
    if (['curl', 'py', 'js', 'env'].indexOf(name) !== -1) {
      const snip = $('#snippet');
      if (snip) snip.textContent = window._snips[name] || '';
    }
  }
  // Model used by every copy-paste example. The docs used to hardcode gpt-5.5,
  // which most keys are not entitled to: pasting it returned 403 "This token has
  // no access to model gpt-5.5" and read like the key was broken. allowed_models
  // is the same list the chips render, so its first entry is always callable.
  const FALLBACK_MODEL = 'gpt-5.5';
  function allowedModels() {
    const list = (window._lastData && window._lastData.allowed_models) || null;
    return Array.isArray(list) ? list.filter((m) => typeof m === 'string' && m) : [];
  }
  function sampleModel() {
    const list = allowedModels();
    return list.length ? list[0] : FALLBACK_MODEL;
  }
  // Codex speaks the Responses API (wire_api = "responses"), which only the
  // gpt-* models serve here. Used both to pick the model for its config and to
  // decide whether the tab is shown at all.
  function gptModels() {
    return allowedModels().filter((m) => /^gpt-/i.test(m));
  }
  // Claude CLI talks the native Anthropic wire (/v1/messages) and only accepts
  // claude-* model names, so it gets its own subset for the same reason Codex
  // does: showing a guide the key cannot follow reads as a broken key.
  function claudeModels() {
    return allowedModels().filter((m) => /^claude-/i.test(m));
  }
  // Claude CLI runs background chores (titles, file summaries) on
  // ANTHROPIC_SMALL_FAST_MODEL. Pointing that at Opus burns 5x the credits for
  // work the user never reads, so prefer Haiku, then Sonnet, then whatever is
  // left.
  function claudeFastModel() {
    const list = claudeModels();
    return list.find((m) => /haiku/i.test(m))
      || list.find((m) => /sonnet/i.test(m))
      || list[0]
      || '';
  }

  /**
   * Substitutes {model} in the static guide code blocks.
   *
   * The raw template is cached in a data attribute on first pass: without it a
   * second run (login, language switch) would find the token already replaced
   * and keep whatever model the anonymous view guessed.
   *
   * data-model-tpl="gpt" opts a block into the Responses-capable subset; it
   * falls back to the plain sample so the markup never renders an empty model.
   */
  function applyModelTpl() {
    document.querySelectorAll('[data-model-tpl], [data-connection-tpl]').forEach((el) => {
      const want = el.getAttribute('data-model-tpl');
      const subset = want === 'gpt' ? gptModels() : want === 'claude' ? claudeModels() : [];
      const m = subset[0] || sampleModel();
      // {fast_model} is the cheap chore model; falls back to the main one so the
      // block never renders an empty value.
      const fast = (want === 'claude' && claudeFastModel()) || m;
      if (el.dataset.tplRaw == null) el.dataset.tplRaw = el.textContent;
      el.textContent = el.dataset.tplRaw
        .split('{fast_model}').join(fast)
        .split('{model}').join(m)
        .split('{base_url}').join(BASE_URL)
        .split('{public_url}').join(PUBLIC_URL)
        .split('{api_key}').join(window._lastKey || 'sk-...');
    });
  }

  /**
   * Hides guide tabs the current key cannot follow.
   *
   * Codex CLI is the only client here pinned to /v1/responses. A claude-only key
   * would copy the config, get an error on the first prompt and read it as the
   * key being broken -- so the tab is removed rather than left as a trap.
   */
  function syncTabs() {
    // Guides pinned to one wire protocol: Codex needs /v1/responses (gpt-* only),
    // Claude CLI needs /v1/messages (claude-* only).
    const gated = [
      { tab: 'codex', has: () => gptModels().length > 0 },
      { tab: 'claude', has: () => claudeModels().length > 0 },
    ];
    let strandedActive = false;
    gated.forEach((g) => {
      const tab = document.querySelector('.tab[data-tab="' + g.tab + '"]');
      if (!tab) return;
      const ok = g.has();
      tab.hidden = !ok;
      if (!ok && tab.classList.contains('active')) strandedActive = true;
    });
    // Leaving a hidden tab active would strand its pane on screen with no way
    // back to it, so hand control to the default tab.
    if (strandedActive) {
      const fallback = document.querySelector('.tab[data-tab="curl"]');
      if (fallback) fallback.click();
    }
  }

  function applyI18n(lang) {
    const model = sampleModel();
    document.querySelectorAll('[data-i18n]').forEach((el) => {
      const key = el.getAttribute('data-i18n');
      const val = (I18N[lang] && I18N[lang][key]) || I18N.ru[key] || key;
      el.textContent = val;
    });
    // гайды: data-i18n-ru='{"html":"..."}' / data-i18n-en='{"html":"..."}'
    document.querySelectorAll('[data-i18n-ru]').forEach((el) => {
      const attrName = 'data-i18n-' + lang;
      const raw = el.getAttribute(attrName);
      if (!raw) return;
      // {model} is substituted here rather than in a later pass: the source of
      // truth stays the attribute, so re-running with another language cannot
      // resurrect a stale model name.
      try {
        const obj = JSON.parse(raw);
        if (obj.html != null) {
          el.innerHTML = obj.html
            .split('{model}').join(esc(model))
            .split('{base_url}').join(esc(BASE_URL))
            .split('{public_url}').join(esc(PUBLIC_URL));
        }
      }
      catch (_) { /* оставляем как есть при ошибке парсинга */ }
    });
    applyModelTpl();
    document.title = PORTAL_NAME + ' — ' + t('page.title');
  }

  // ---------------- helpers ----------------
  function fmt(n) {
    n = Number(n) || 0;
    if (n >= 1e9) return (n / 1e9).toFixed(2).replace(/\.00$/, '') + 'B';
    if (n >= 1e6) return (n / 1e6).toFixed(2).replace(/\.00$/, '') + 'M';
    if (n >= 1e3) return (n / 1e3).toFixed(1).replace(/\.0$/, '') + 'K';
    return String(n);
  }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  }
  function maskKey(key) {
    return key.length > 12 ? key.slice(0, 7) + '…' + key.slice(-4) : 'sk-…';
  }
  function showErr(msg) {
    const e = $('#err');
    e.textContent = msg;
    e.style.display = 'block';
  }

  // ---------------- login ----------------
  async function login() {
    const key = $('#key').value.trim();
    if (!key) return showErr(t('err.empty'));
    $('#err').style.display = 'none';
    const btn = $('#loginBtn');
    btn.disabled = true;
    const orig = btn.innerHTML;
    btn.textContent = '…';

    try {
      const r = await fetch('/api/portal/me', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key }),
      });
      if (r.status === 401 || r.status === 403) {
        showErr(t('err.invalid'));
        resetBtn(btn, orig);
        return;
      }
      if (r.status === 429) {
        // The server knows the provider's recovery window, so show a live
        // countdown and retry by itself instead of asking the user to guess.
        let wait = 15;
        try {
          const b = await r.json();
          if (b && Number(b.retry_after) > 0) wait = Math.min(120, Number(b.retry_after));
        } catch (_) { /* keep default */ }
        startRetryCountdown(btn, orig, wait);
        return;
      }
      if (r.status === 502 || r.status === 503 || r.status === 504) {
        showErr(t('err.upstream'));
        resetBtn(btn, orig);
        return;
      }
      if (!r.ok) throw new Error('http ' + r.status);
      const data = await r.json();
      sessionStorage.setItem(SESSION_KEY, key);
      resetBtn(btn, orig);
      render(data, key);
      startDashboardRefresh();
    } catch (e) {
      showErr(t('err.network'));
      resetBtn(btn, orig);
    }
  }
  function resetBtn(btn, orig) {
    btn.disabled = false;
    btn.innerHTML = orig;
  }

  // Rate-limit countdown: keeps the button disabled for the provider's recovery
  // window, then retries once on its own. Without this the user hammers the
  // button and keeps the limit alive.
  let retryTimer = null;
  let dashboardTimer = null;
  function startRetryCountdown(btn, orig, seconds) {
    if (retryTimer) clearInterval(retryTimer);
    let left = Math.max(1, Math.round(seconds));
    btn.disabled = true;
    const tick = () => {
      showErr(t('err.rateLimitedWait').replace('{s}', String(left)));
      btn.textContent = left + 's';
      if (left <= 0) {
        clearInterval(retryTimer);
        retryTimer = null;
        resetBtn(btn, orig);
        $('#err').style.display = 'none';
        login();
        return;
      }
      left -= 1;
    };
    tick();
    retryTimer = setInterval(tick, 1000);
  }
  function logout() {
    if (dashboardTimer) clearInterval(dashboardTimer);
    dashboardTimer = null;
    sessionStorage.removeItem(SESSION_KEY);
    $('#dash').hidden = true;
    $('#login').style.display = 'flex';
    $('#key').value = '';
    window._lastData = null;
    window._lastKey = null;
    pricingData = null;
    statusData = null;
    window.scrollTo(0, 0);
  }


  // Credit amounts are exact decimals, so they must not go through fmt()'s
  // K/M abbreviation: "937.5" has to stay readable as a price.
  function fmtCr(n) {
    const v = Number(n) || 0;
    // Sub-credit charges need more precision than the 2 decimals used for
    // balances, but both must go through the same locale so the dashboard does
    // not mix "0.26" and "999,74" on the same screen.
    const digits = v > 0 && v < 1 ? 4 : 2;
    return v.toLocaleString(getLang() === 'ru' ? 'ru-RU' : 'en-US', {
      maximumFractionDigits: digits,
    });
  }

  // ---------------- models: id + price + status in one row ----------------
  // Price and status arrive from two endpoints that finish independently, so
  // both are cached here and every arrival re-renders the merged list. Two
  // separate lists (or tabs) forced the reader to cross-reference by hand to
  // answer "what does this cost and is it up right now".
  const STATE_COLORS = {
    available: '#10b981',
    degraded: '#f59e0b',
    down: '#f43f5e',
    unknown: '#949494',
  };

  let pricingData = null;
  let statusData = null;

  function priceLabel(x) {
    if (!x) return '—';
    if (x.per_call_credits != null) return fmtCr(x.per_call_credits) + ' / ' + t('perCall');
    if (x.input_credits != null) {
      const out = x.output_credits != null ? ' / ' + fmtCr(x.output_credits) : '';
      return fmtCr(x.input_credits) + out;
    }
    return '—';
  }

  function renderModels() {
    const ul = $('#usageRates');
    const summary = $('#modelStatusSummary');
    if (!ul) return;

    const priceBy = new Map();
    ((pricingData && pricingData.items) || []).forEach((x) => {
      if (x && x.model) priceBy.set(x.model, x);
    });
    const stateBy = new Map();
    ((statusData && statusData.models) || []).forEach((m) => {
      if (m && m.model) stateBy.set(m.model, m);
    });

    // The set of rows is whatever THIS key may call, taken from the same
    // allowed_models the "available models" chips render. Deriving it from the
    // price list instead let the two panels disagree: allowed_models honours the
    // key's model_limits, while /api/pricing only knows the /v1/models
    // entitlement, so a limited key saw prices for models its chips did not
    // list. One source, one set.
    const allowed = (window._lastData && window._lastData.allowed_models) || null;
    let ids = allowed && allowed.length
      ? allowed.slice()
      : ((pricingData && pricingData.items) || []).map((x) => x.model).filter(Boolean);
    ids = ids.filter(Boolean);
    if (!ids.length) {
      ul.innerHTML = `<li class="sp-empty"><code>${esc(t('noModels'))}</code></li>`;
      if (summary) summary.textContent = t('status.unknown');
      return;
    }

    // Cheapest first, matching the price list's own ordering. Models we have no
    // price for sort last instead of jumping to the front on a 0.
    const rank = (id) => {
      const x = priceBy.get(id);
      if (!x) return Number.POSITIVE_INFINITY;
      if (x.input_credits != null) return Number(x.input_credits);
      if (x.per_call_credits != null) return Number(x.per_call_credits);
      return Number.POSITIVE_INFINITY;
    };
    ids.sort((a, b) => (rank(a) - rank(b)) || a.localeCompare(b));

    // The summary must count the rows actually on screen. statusData covers the
    // server's own view, which can be a different set than this key's, and using
    // its totals produced "6/7" above a list of 18.
    if (summary) {
      let known = 0;
      let healthy = 0;
      let bad = 0;
      ids.forEach((id) => {
        const m = stateBy.get(id);
        if (!m) return;
        known += 1;
        if (m.state === 'available') healthy += 1;
        // 'unknown' means the model saw no requests in the window, which is an
        // absence of measurement rather than a fault. Treating it as unhealthy
        // showed "Частичные перебои · 5/8" while nothing was actually failing.
        else if (m.state === 'down' || m.state === 'degraded') bad += 1;
      });
      const overall = !known ? 'unknown'
        : bad === 0 ? 'operational'
        : bad === known ? 'outage'
        : 'partial';
      const c = overall === 'operational' ? STATE_COLORS.available
        : overall === 'partial' ? STATE_COLORS.degraded
        : overall === 'outage' ? STATE_COLORS.down
        : STATE_COLORS.unknown;
      // Count only when something is actually broken. On a green verdict
      // "5/8" invited the question "what about the other three", when the
      // answer was merely "they had no traffic".
      summary.innerHTML = `<span style="color:${c}">${esc(t('status.' + overall) || overall)}</span>`
        + (bad > 0 ? ` · ${bad}/${known}` : '');
    }

    ul.innerHTML = ids
      .map((id) => {
        const x = priceBy.get(id);
        const m = stateBy.get(id);

        // Models that get more expensive past a context threshold must say so,
        // otherwise the published price understates a long request.
        let tier = '';
        if (x && x.long_context_from && x.long_context_multiplier > 1) {
          const hint = t('dash.longCtx')
            .replace('{x}', String(x.long_context_multiplier))
            .replace('{n}', fmt(x.long_context_from));
          tier = ` <em class="tier-hint" title="${esc(hint)}">×${esc(String(x.long_context_multiplier))}</em>`;
        }

        // Status is unknown until /api/model-status answers; showing green
        // early would claim availability we have not verified.
        const state = m ? m.state : 'unknown';
        const c = STATE_COLORS[state] || STATE_COLORS.unknown;
        const label = t('status.' + state) || state;

        // Latency/success exist only where real traffic went through us, so an
        // untouched model shows its state alone instead of a fake 0 ms.
        // Latency must not go through fmt(): it abbreviates 1416 to "1.4K",
        // which reads as nonsense next to "ms". Seconds past 1000ms instead.
        const bits = [];
        if (m && m.latency_ms != null) {
          const ms = Number(m.latency_ms);
          bits.push(ms >= 1000 ? (ms / 1000).toFixed(1) + ' s' : Math.round(ms) + ' ms');
        }
        if (m && m.success_pct != null) bits.push(Number(m.success_pct).toFixed(0) + '%');
        const meta = bits.length ? ` <em class="status-meta">${esc(bits.join(' · '))}</em>` : '';

        return `<li><code>${esc(id)}</code>`
          + `<span class="mprice">${esc(priceLabel(x))}${tier}</span>`
          + `<strong><span class="status-dot" style="background:${c}"></span>`
          + `<span style="color:${c}">${esc(label)}</span>${meta}</strong></li>`;
      })
      .join('');
  }

  // Both endpoints filter by the caller's entitlement, so the logged-in key must
  // travel with the request. Without it the server answers with its own public
  // set, which is how this list came to disagree with the "available models"
  // chips: a key entitled to 18 models was shown our own 7.
  function authHeaders() {
    const k = window._lastKey;
    return k ? { Authorization: 'Bearer ' + k } : undefined;
  }

  // Recent requests table. Split out of render() because the per-cell credit
  // cost needs /api/pricing, which lands after the first paint: without a
  // redraw on that arrival the token cells stayed bare until the next login.
  function renderRecent() {
    const tbody = $('#recent');
    if (!tbody) return;
    const hasAnalytics = Boolean(window._lastData && window._lastData.analytics);
    const a = hasAnalytics ? window._lastData.analytics : {};
    const rec = a.recent || [];

    // Cost per cell is derived from the published per-1M prices, then rescaled
    // so the three parts add up to the charge the upstream actually reported for
    // the row. A long-context request bills at a multiple of the flat rate, so
    // the unscaled parts would understate what was really deducted.
    const priceBy = new Map();
    ((pricingData && pricingData.items) || []).forEach((p) => {
      if (p && p.model) priceBy.set(p.model, p);
    });

    tbody.innerHTML =
      rec
        .slice(0, 50)
        .map((x) => {
          const ts = (x.ts || '').replace('T', ' ').slice(0, 16);
          const status = x.success
            ? `<span class="dot-ok">${t('status.ok')}</span>`
            : `<span class="dot-bad" title="${esc(x.error || '')}" style="cursor:help">${t('status.fail')}</span>`;

          const p = priceBy.get(x.model);
          const perM = (tok, rate) =>
            rate != null && Number(tok) > 0 ? (Number(tok) / 1e6) * Number(rate) : 0;
          let cIn = perM(x.input, p && p.input_credits);
          let cOut = perM(x.output, p && p.output_credits);
          let cCache = perM(x.cached, p && p.cache_credits);
          const derived = cIn + cOut + cCache;
          const actual = Number(x.credits || 0);
          if (derived > 0 && actual > 0) {
            const k = actual / derived;
            cIn *= k;
            cOut *= k;
            cCache *= k;
          }
          // Under ~0.0001 the credit formatter rounds to "0", and "0 кредитов"
          // beneath a real token count reads as a bug rather than as "too cheap
          // to show".
          const sub = (cr) =>
            cr > 0.00005 ? `<div class="tsub">${fmtCr(cr)} ${t('credits')}</div>` : '';

          return `<tr>
            <td class="mono muted">${esc(ts)}</td>
            <td class="mono">${esc(x.model)}</td>
            <td class="mono">${fmt(x.input)}${sub(cIn)}</td>
            <td class="mono">${fmt(x.output)}${sub(cOut)}</td>
            <td class="mono">${x.cached ? fmt(x.cached) + sub(cCache) : '<span class="muted2">—</span>'}</td>
            <td class="mono">${x.credits ? fmtCr(x.credits) : '<span class="muted2">—</span>'}</td>
            <td>${status}</td>
          </tr>`;
        })
        .join('') || `<tr><td colspan="7" class="muted2">${hasAnalytics ? t('noRequests') : t('noData')}</td></tr>`;
  }

  async function refreshDashboard() {
    const key = window._lastKey;
    if (!key || document.hidden) return;
    try {
      const response = await fetch('/api/portal/me', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key }),
      });
      if (!response.ok || window._lastKey !== key) return;
      const data = await response.json();
      if (window._lastKey === key) render(data, key, { silent: true });
    } catch (_) {
      // Keep the last verified snapshot on screen.
    }
  }

  function startDashboardRefresh() {
    if (dashboardTimer) clearInterval(dashboardTimer);
    dashboardTimer = setInterval(refreshDashboard, 60000);
  }

  function renderSync(data) {
    const line = $('#syncLine');
    const label = $('#syncState');
    if (!line || !label || !data) return;
    const rawTime = data.synced_at || data.updated_at;
    const date = rawTime ? new Date(rawTime) : null;
    const time = date && !Number.isNaN(date.getTime())
      ? date.toLocaleTimeString(getLang() === 'ru' ? 'ru-RU' : 'en-US', { hour: '2-digit', minute: '2-digit' })
      : '—';
    const stale = data.cached || data.analytics_status === 'stale' || (statusData && statusData.stale);
    line.classList.toggle('is-stale', Boolean(stale));
    label.textContent = t(stale ? 'sync.cached' : 'sync.live').replace('{time}', time);
  }

  function renderAnalytics() {
    const data = window._lastData || {};
    const analytics = data.analytics;
    const unit = getUnit();
    const notice = $('#analyticsNotice');
    syncUnitToggle();

    if (notice) {
      const state = data.analytics_status || (analytics ? 'live' : 'unavailable');
      notice.hidden = state === 'live';
      notice.textContent = state === 'stale' ? t('sync.stale') : t('sync.unavailable');
    }

    if (!analytics) {
      $('#reqTotal').textContent = '—';
      $('#successRate').textContent = '—';
      $('#chart').innerHTML = `<div class="muted2">${t('noData')}</div>`;
      $('#byModel').innerHTML = `<div class="muted2">${t('noData')}</div>`;
      const tokEl = $('#usedTokens');
      if (tokEl) tokEl.hidden = true;
      renderRecent();
      return;
    }

    $('#reqTotal').textContent = fmt(analytics.total_requests || 0);
    $('#successRate').textContent = analytics.success_rate != null
      ? Math.round(analytics.success_rate * 100) + '%'
      : '—';

    const spentTok = Number(analytics.spent_tokens || 0);
    const cachedTok = Number(analytics.cached_tokens || 0);
    const tokEl = $('#usedTokens');
    if (tokEl) {
      tokEl.hidden = spentTok <= 0;
      tokEl.textContent = cachedTok > 0
        ? t('dash.spentTokensCached').replace('{n}', fmt(spentTok)).replace('{c}', fmt(cachedTok))
        : t('dash.spentTokens').replace('{n}', fmt(spentTok));
    }

    const isTokens = unit === 'tokens';
    const unitLabel = isTokens ? t('dash.unitTokens').toLowerCase() : t('credits');
    const chartTitle = $('#chartTitle');
    const byModelTitle = $('#byModelTitle');
    if (chartTitle) chartTitle.textContent = t('dash.tokens14') + ' · ' + unitLabel;
    if (byModelTitle) byModelTitle.textContent = t('dash.byModel') + ' · ' + unitLabel;

    const days = analytics.tokens_by_day || [];
    const valueOf = (item) => Number(isTokens ? item.tokens : item.credits) || 0;
    const maxValue = Math.max(0.01, ...days.map(valueOf));
    $('#chart').innerHTML = days.map((item) => {
      const value = valueOf(item);
      const height = value > 0 ? Math.max(2, Math.round((value / maxValue) * 100)) : 0;
      const shown = isTokens ? fmt(value) : fmtCr(value);
      return `<div class="col" title="${esc(item.date)}: ${esc(shown)} ${esc(unitLabel)}"><i style="height:${height}%"></i><span>${esc((item.date || '').slice(5))}</span></div>`;
    }).join('') || `<div class="muted2">${t('noData')}</div>`;

    const models = analytics.by_model || [];
    const modelMax = Math.max(0.01, ...models.map(valueOf));
    $('#byModel').innerHTML = models.map((item) => {
      const value = valueOf(item);
      const shown = isTokens ? fmt(value) : fmtCr(value);
      return `<div class="mrow"><span class="nm">${esc(item.model)}</span>`
        + `<span class="mbar"><i style="width:${Math.round((value / modelMax) * 100)}%"></i></span>`
        + `<span class="v">${shown} ${esc(unitLabel)} · ${fmt(item.requests)} ${t('requests')}</span></div>`;
    }).join('') || `<div class="muted2">${t('noData')}</div>`;

    renderRecent();
  }

  async function loadPricing() {
    const key = window._lastKey;
    try {
      const r = await fetch('/api/pricing', { headers: authHeaders() });
      if (!r.ok || window._lastKey !== key) return;
      const next = await r.json();
      if (window._lastKey !== key) return;
      if ((next && next.items && next.items.length) || !pricingData) pricingData = next;
      renderModels();
      // Prices drive the per-cell credit sublabels too.
      renderRecent();
    } catch (_) {
      /* keep static fallback */
    }
  }

  async function loadModelStatus() {
    const key = window._lastKey;
    try {
      const r = await fetch('/api/model-status', { headers: authHeaders() });
      if (!r.ok || window._lastKey !== key) return;
      const next = await r.json();
      if (window._lastKey !== key) return;
      if ((next && next.models && next.models.length) || !statusData) statusData = next;
      renderModels();
      renderSync(window._lastData);
    } catch (_) {
      /* leave placeholder */
    }
  }

  // ---------------- render dashboard ----------------
  function render(d, key, options = {}) {
    if (window._lastKey && window._lastKey !== key) {
      pricingData = null;
      statusData = null;
    }
    window._lastData = d;
    window._lastKey = key;
    if (options.refreshRemote !== false) {
      loadPricing();
      loadModelStatus();
    }
    // A language switch re-runs render(); the merged list must be redrawn from
    // the cached payloads so labels like "Работает" follow the new language
    // without waiting for another round-trip.
    renderModels();

    const lang = getLang();
    const limit = d.limit_credits || 0;
    const used = d.used_credits || 0;
    const remaining = d.remaining_credits != null ? d.remaining_credits : Math.max(0, limit - used);
    const held = d.held_credits || 0;
    const settledUsed = used;

    $('#keytag').textContent = maskKey(key);
    $('#remaining').textContent = fmtCr(remaining);
    // An unlimited key reports limit_credits = 0, and a package of 0 is not a
    // number worth printing: substituting it left the literal "из —" on screen.
    // With no package there is also nothing to draw a progress bar against.
    const subEl = $('#remainingSub');
    const barWrap = $('#remainingBar') && $('#remainingBar').parentElement;
    if (limit > 0) {
      subEl.hidden = false;
      subEl.textContent = t('dash.ofPackage').replace('—', fmtCr(limit))
        + (d.balance_mode === 'daily' ? t('daily') : t('package'));
      const pct = Math.max(0, Math.min(100, (remaining / limit) * 100));
      const bar = $('#remainingBar');
      bar.style.width = pct + '%';
      bar.style.background = pct < 10 ? 'var(--bad)' : '';
      if (barWrap) barWrap.hidden = false;
    } else {
      subEl.hidden = true;
      subEl.textContent = '';
      if (barWrap) barWrap.hidden = true;
    }

    $('#used').textContent = fmtCr(settledUsed);

    const holdEl = $('#remainingHold');
    if (held > 0) {
      holdEl.hidden = false;
      holdEl.style.color = 'var(--warn)';
      holdEl.textContent = t('held') + ': ' + fmtCr(held) + t('heldSuffix');
    } else {
      holdEl.hidden = true;
    }

    // The server publishes a plan label key, never the upstream key's own name
    // (that was an internal label like "Ключ реселлера"). One label for every
    // key, so an older payload or an unknown key still resolves to it.
    $('#planName').textContent = t('plan.' + (d.plan_tier || 'nolimit')) || t('plan.nolimit');
    const expiryEl = $('#expiry');
    if (d.expires_at) {
      const dt = new Date(d.expires_at);
      expiryEl.textContent = t('expires.prefix') + dt.toLocaleDateString(lang === 'ru' ? 'ru-RU' : 'en-US');
    } else {
      expiryEl.textContent = t('dash.noExpiry');
    }

    const models = d.allowed_models && d.allowed_models.length ? d.allowed_models : [t('noModels')];
    $('#models').innerHTML = models.map((m) => `<span class="chip">${esc(m)}</span>`).join('');
    renderAnalytics();
    renderSync(d);

    // Connection snippets use the Base URL supplied by /api/config.
    const base = BASE_URL;
    $('#baseUrl').textContent = base;
    refreshSnips();
    // Guides live in static markup, so they need an explicit refresh once the
    // entitled list is known -- applyI18n() ran before login with no data.
    applyModelTpl();
    applyI18n(getLang());
    // Dynamic values must be painted after i18n: the generic translated
    // placeholders otherwise overwrite values such as "of 10,000" and the
    // selected analytics unit.
    if (limit > 0) {
      subEl.textContent = t('dash.ofPackage').replace('—', fmtCr(limit))
        + (d.balance_mode === 'daily' ? t('daily') : t('package'));
    }
    renderModels();
    renderAnalytics();
    // Entitlements are known only now, so tab visibility is decided here.
    syncTabs();
    const activeTab = document.querySelector('.tab.active');
    const activeTabName = (activeTab && activeTab.getAttribute('data-tab')) || 'curl';
    syncOsRow(activeTabName);
    applyOsVisibility();
    if (['curl', 'py', 'js', 'env'].includes(activeTabName)) {
      $('#snippet').textContent = window._snips[activeTabName] || '';
    }

    $('#login').style.display = 'none';
    $('#dash').hidden = false;
    if (!options.silent) window.scrollTo(0, 0);
  }

  // ---------------- news banner ----------------
  async function loadNews() {
    try {
      const r = await fetch('/api/news?limit=5');
      if (!r.ok) return;
      const data = await r.json();
      const items = (data && data.items) || [];
      if (items.length === 0) return;
      // показываем самую свежую, которую пользователь ещё не закрывал
      const closedId = parseInt(localStorage.getItem(NEWS_CLOSED_KEY) || '0', 10);
      const item = items.find((x) => x.id !== closedId) || null;
      if (!item) return;
      const lang = getLang();
      const text = (lang === 'en' && item.en) || item.ru || item.en || '';
      if (!text) return;
      const txtEl = $('#newsText');
      txtEl.innerHTML = renderMarkdown(esc(text));
      txtEl.dataset.id = String(item.id);
      $('#newsBanner').hidden = false;
    } catch (e) {
      /* тихо */
    }
  }

  function renderMarkdown(safe) {
    // безопасный markdown: после esc() -> разметка уже экранирована.
    // Применяем только ссылки/жирный/курсив/перенос строк поверх.
    return safe
      .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>')
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/(^|[^*])\*([^*]+)\*/g, '$1<em>$2</em>')
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/\n/g, '<br>');
  }

  function closeNews() {
    $('#newsBanner').hidden = true;
    // запоминаем id текущей показанной новости
    const id = parseInt($('#newsText').dataset.id || '0', 10);
    if (id) localStorage.setItem(NEWS_CLOSED_KEY, String(id));
  }

  // ---------------- copy config ----------------
  function copyConfig() {
    // Same rule as the snippets: ship a model this key can actually call, not a
    // hardcoded one that answers 403 on first run.
    //
    // The wire protocol follows the model: only gpt-* serve /v1/responses here,
    // so a claude-only key gets wire_api = "chat". Emitting "responses" for it
    // produced a config that authenticated fine and then failed on the first
    // prompt, which reads as a broken key rather than a wrong protocol.
    const gpt = gptModels()[0] || '';
    const model = gpt || sampleModel();
    const cfg =
      `model = "${model}"\n` +
      `model_provider = "reseller"\n` +
      `\n` +
      `[model_providers.reseller]\n` +
      `name = "Reseller"\n` +
      `base_url = "${BASE_URL}"\n` +
      `wire_api = "responses"\n` +
      `env_key = "RESELLER_API_KEY"`;
    copyText(cfg, $('#copyKey'));
  }

  function copyText(text, btn) {
    const done = () => {
      const orig = btn.innerHTML;
      btn.textContent = t('copy.done');
      setTimeout(() => { btn.innerHTML = orig; }, 1200);
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done, () => fallbackCopy(text, done));
    } else {
      fallbackCopy(text, done);
    }
  }
  function fallbackCopy(text, cb) {
    const ta = document.createElement('textarea');
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); } catch (_) {}
    document.body.removeChild(ta);
    cb && cb();
  }

  // ---------------- bind events ----------------
  function bindEvents() {
    $('#loginBtn').addEventListener('click', login);
    $('#key').addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) login();
    });
    $('#logout').addEventListener('click', logout);
    $('#copyKey').addEventListener('click', copyConfig);
    $('#copyBase').addEventListener('click', () => copyText($('#baseUrl').textContent, $('#copyBase')));
    $('#copySnippet').addEventListener('click', () => copyText($('#snippet').textContent, $('#copySnippet')));
    $('#newsClose').addEventListener('click', closeNews);

    // список имён табов-гайдов (каждому соответствует .guide-pane[data-guide])
    const GUIDE_TABS = ['cursor', 'vscode', 'continue', 'grok', 'claude', 'codex', 'opencode', 'aider', 'silly', 'cherry'];

    document.querySelectorAll('.tab').forEach((tab) =>
      tab.addEventListener('click', () => {
        document.querySelectorAll('.tab').forEach((x) => x.classList.remove('active'));
        tab.classList.add('active');
        const tabName = tab.getAttribute('data-tab');
        const isGuide = GUIDE_TABS.includes(tabName);
        const snip = $('#snippet');
        const guides = $('#guidesPanel');
        const copyBtn = $('#copySnippet');
        // The OS switch only appears on tabs whose commands actually differ.
        syncOsRow(tabName);
        if (isGuide) {
          // показать панель гайдов и нужный гайд внутри
          if (snip) snip.hidden = true;
          if (guides) guides.hidden = false;
          guides.querySelectorAll('.guide-pane').forEach((p) => {
            p.hidden = p.getAttribute('data-guide') !== tabName;
          });
          // Panes carry per-OS blocks, so re-apply after the pane becomes visible.
          applyOsVisibility();
          if (copyBtn) copyBtn.style.display = 'none';
        } else {
          // показать сниппет кода
          if (guides) guides.hidden = true;
          if (snip) { snip.hidden = false; snip.textContent = (window._snips || {})[tabName] || ''; }
          if (copyBtn) copyBtn.style.display = '';
        }
      }),
    );

    document.querySelectorAll('[data-lang-btn]').forEach((b) =>
      b.addEventListener('click', () => setLang(b.getAttribute('data-lang-btn'))),
    );

    document.querySelectorAll('[data-os-btn]').forEach((b) =>
      b.addEventListener('click', () => setOs(b.getAttribute('data-os-btn'))),
    );
    document.querySelectorAll('[data-unit-btn]').forEach((b) =>
      b.addEventListener('click', () => setUnit(b.getAttribute('data-unit-btn'))),
    );
  }

  // ---------------- init ----------------
  async function init() {
    // язык: сохранённый или автоопределение из настроек браузера
    const lang = getLang();
    localStorage.setItem(LANG_KEY, lang);
    document.documentElement.lang = lang;
    syncLangToggle(lang);
    applyI18n(lang);

    // OS: saved choice or detection from the browser. Done before bindEvents so
    // the very first paint already matches the visitor's platform.
    const os = getOs();
    localStorage.setItem(OS_KEY, os);
    syncOsToggle(os);
    applyOsVisibility();

    await loadConfig();
    applyI18n(lang);
    syncUnitToggle();

    bindEvents();
    loadNews();

    // авто-вход если ключ сохранён
    const saved = sessionStorage.getItem(SESSION_KEY);
    if (saved) {
      $('#key').value = saved;
      login();
    }
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden && window._lastKey) refreshDashboard();
    });
  }

  document.addEventListener('DOMContentLoaded', init);
})();
