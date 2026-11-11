'use strict';

/* =========================================================
 * api-portal API portal — frontend logic
 * ========================================================= */

(function () {
  const $ = (s) => document.querySelector(s);
  const LANG_KEY = 'cx_lang';
  const OS_KEY = 'cx_os';
  const THEME_KEY = 'cx_theme';
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
      'dash.remainingTokens': 'Остаток токенов',
      'dash.remainingPackage': 'Остаток пакета',
      'dash.usedPackageSub': 'израсходовано токенов пакета',
      'dash.noExpiryPackage': 'действует до исчерпания пакета; расход зависит от модели и тарифа',
      'dash.t.chargedPackage': 'Списано из пакета',
      'dash.remainingCredits': 'Остаток кредитов',
      'dash.remainingUsd': 'Остаток ключа',
      'dash.ofPackage': 'из —',
      'dash.used': 'Списано',
      'dash.usedTokenSub': 'всего израсходовано токенов',
      'dash.usedCreditSub': 'всего израсходовано кредитов',
      'dash.usedUsdSub': 'всего списано по тарифам, USD',
      'dash.plan': 'Тариф',
      'dash.noExpiryTokens': 'действует до тех пор, пока вы не потратите все свои токены',
      'dash.noExpiryCredits': 'действует до тех пор, пока вы не потратите все свои кредиты',
      'dash.noExpiryUsd': 'действует до исчерпания баланса; списание идёт по тарифам моделей',
      'dash.connect': 'Подключение API',
      'dash.copy': 'Копировать',
      'dash.compatNote': 'OpenAI-совместимо — подставьте Base URL и свой ключ в любой OpenAI-клиент или SDK. Доступные модели — в разделе выше.',
      'dash.modelsTitle': 'Модели',
      'dash.modelsNote': 'Токены пакета за 1 млн токенов модели: вход / выход. Справа — доступность по реальному трафику.',
      'dash.modelsNoteCredits': 'Кредиты за 1 млн токенов модели: вход / выход. Справа — доступность по реальному трафику.',
      'dash.modelsPanelNote': 'Базовые тарифы New API в USD: вход / выход за 1 млн токенов или за вызов. Коэффициент источника применяется отдельно.',
      'dash.rawBillingNote': 'Текстовые запросы: из пакета списываются входные и выходные токены без чтения кэша. Сумма списания по каждому запросу — в журнале ниже.',
      'dash.tariffBillingNote': 'Токены пакета — условные единицы баланса по цене его покупки. Это ориентир, а не количество токенов, которое выдаст любая модель. Запрос оплачивается по тарифу New API: учитываются модель, вход, выход, кэш и источник; для аудио и видео — их тарифы. В журнале вход, выход и кэш показывают фактические токены модели, а «Списано из пакета» — расход баланса.',
      'dash.walletBillingNote': 'Списание в USD рассчитывается по тарифу модели и выбранного источника. Фактические токены и списанная сумма показаны отдельно в журнале.',
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
      'sync.live': 'Синхронизировано {time}',
      'sync.cached': 'Последний снимок · {time}',
      'sync.stale': 'Данные журнала временно устарели',
      'sync.unavailable': 'Журнал New API временно недоступен — нули не подставлены',
      'dash.recent': 'Недавние запросы',
      'dash.history.packageNote': 'Справа — расход пакета за один запрос по тарифу New API. Это не сумма токенов слева и не накопительный итог. Кэш учитывается по тарифу, а не автоматически вычитается целиком.',
      'dash.history.creditNote': 'Справа — расход кредитов за один запрос по тарифу New API. Это не сумма токенов слева и не накопительный итог. Кэш учитывается по тарифу, а не автоматически вычитается целиком.',
      'dash.history.usdNote': 'Справа — сумма в USD, списанная за отдельный запрос по тарифу модели. Вход, выход, кэш и платные инструменты уже учтены в итоговом списании.',
      'dash.history.tokenNote': 'Справа — списание токенов за один запрос из журнала New API. Каждая строка показывает отдельное списание, а не накопительный итог.',
      'dash.history.details': 'Что влияет на списание',
      'dash.history.context': 'Вход — переданный модели контекст, включая отправленную историю диалога и результаты инструментов. Поэтому в длинном диалоге вход может расти. Выход — токены, сгенерированные моделью. Кэш показывает работу с кэшем; это не размер скидки.',
      'dash.history.tariff': 'Вход, выход и кэш оплачиваются по настроенным тарифам модели и источника. Платные вызовы инструментов, аудио и видео входят в итог, если их начислила New API. Кабинет показывает записанное списание и не пересчитывает его по формуле «вход + выход − кэш».',
      'dash.history.packageConversion': 'Стоимость запроса переводится в единицы пакета по условиям его покупки. Одинаковое число токенов у разных моделей может расходовать разное количество единиц пакета.',
      'dash.history.packageUnit': 'ед. пакета · за запрос',
      'dash.history.tokenUnit': 'токены · за запрос',
      'dash.history.creditUnit': 'кредиты · за запрос',
      'dash.history.usdUnit': 'USD · за запрос',
      'dash.history.imageDebit': 'изображение',
      'dash.history.imageTool': 'Генерация изображения',
      'dash.history.toolCall': 'Платный инструмент',
      'dash.t.modelTokens': 'Токены модели',
      'dash.t.time': 'Время',
      'dash.t.model': 'Модель',
      'dash.t.input': 'Вход',
      'dash.t.output': 'Выход',
      'dash.t.cache': 'Кэш',
      'dash.t.chargedTokens': 'Списано, токены',
      'dash.t.chargedCredits': 'Списано, кредиты',
      'dash.t.chargedUsd': 'Списано, USD',
      'dash.t.status': 'Статус',
      'err.empty': 'Введите API-ключ.',
      'err.invalid': 'Неверный или неактивный API-ключ.',
      'err.network': 'Не удалось связаться с сервером. Попробуйте позже.',
      'err.logout': 'Не удалось завершить защищённую сессию. Повторите выход.',
      'err.rateLimited': 'Лимит запросов. Повторите вход вручную.',
      'err.rateLimitedWait': 'Слишком много запросов. Можно повторить через {s} с…',
      'err.upstream': 'Провайдер временно недоступен. Ключ в порядке, попробуйте позже.',
      'copy.done': 'Скопировано!',
      'expires.prefix': 'до ',
      'daily': ' в сутки',
      'package': ' в пакете',
      'perCall': 'за вызов',
      'perM': 'за 1M',
      'tokens': 'токенов',
      'credits': 'кредитов',
      'usd': 'USD',
      'noData': 'нет данных',
      'noRequests': 'запросов нет',
      'noModels': '(нет доступных моделей)',
      'status.ok': '✓ OK',
      'status.fail': '✕ сбой',
      'theme.dark': 'Тёмная тема',
      'theme.light': 'Светлая тема',
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
      'dash.remainingTokens': 'Token balance',
      'dash.remainingPackage': 'Package balance',
      'dash.usedPackageSub': 'package tokens spent',
      'dash.noExpiryPackage': 'valid until the package is exhausted; usage depends on the model and tariff',
      'dash.t.chargedPackage': 'Package debit',
      'dash.remainingCredits': 'Credit balance',
      'dash.remainingUsd': 'Key balance',
      'dash.ofPackage': 'of —',
      'dash.used': 'Spent',
      'dash.usedTokenSub': 'total tokens spent',
      'dash.usedCreditSub': 'total credits spent',
      'dash.usedUsdSub': 'total charged at model rates, USD',
      'dash.plan': 'Plan',
      'dash.noExpiryTokens': 'valid until you spend all your tokens',
      'dash.noExpiryCredits': 'valid until you spend all your credits',
      'dash.noExpiryUsd': 'valid until the balance is exhausted; model rates determine usage',
      'dash.connect': 'API connection',
      'dash.copy': 'Copy',
      'dash.compatNote': 'OpenAI-compatible — set Base URL and your key in any OpenAI client or SDK. Available models are listed above.',
      'dash.modelsTitle': 'Models',
      'dash.modelsNote': 'Package tokens per 1M model tokens: input / output. On the right: availability measured from real traffic.',
      'dash.modelsNoteCredits': 'Credits per 1M model tokens: input / output. On the right: availability measured from real traffic.',
      'dash.modelsPanelNote': 'New API base prices in USD: input / output per 1M tokens, or per call. The source multiplier applies separately.',
      'dash.rawBillingNote': 'Text requests debit input and output tokens from the package, excluding cache reads. See the request log below for each debit.',
      'dash.tariffBillingNote': 'Package tokens are balance units fixed by the purchase price. They are an estimate, not a guaranteed number of tokens for every model. Requests use New API tariffs for the model, input, output, cache and source; audio and video use their respective rates. Input, output and cache in the log are actual model tokens; Package debit is the amount spent from the balance.',
      'dash.walletBillingNote': 'USD is charged at the model and source rates. The log shows actual tokens and the charged amount separately.',
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
      'sync.live': 'Synced {time}',
      'sync.cached': 'Last snapshot · {time}',
      'sync.stale': 'Request log data is temporarily stale',
      'sync.unavailable': 'New API log is temporarily unavailable — no zero values were substituted',
      'dash.recent': 'Recent requests',
      'dash.history.packageNote': 'On the right: package units spent on each request at New API rates. This is neither the sum of the tokens on the left nor a running total. Cache is priced at its configured rate, not automatically deducted in full.',
      'dash.history.creditNote': 'On the right: credits spent on each request at New API rates. This is neither the sum of the tokens on the left nor a running total. Cache is priced at its configured rate, not automatically deducted in full.',
      'dash.history.usdNote': 'On the right: the USD amount charged for each request at the model tariff. Input, output, cache and paid tools are already included in the recorded debit.',
      'dash.history.tokenNote': 'On the right: tokens debited for each request, as recorded by New API. Each row is a separate debit, not a running total.',
      'dash.history.details': 'What affects the debit',
      'dash.history.context': 'Input is the context sent to the model, including any conversation history and tool results sent with the request. It can grow as a conversation continues. Output is tokens generated by the model. Cache shows cache usage, not a discount amount.',
      'dash.history.tariff': 'Input, output and cache use the configured model and source rates. Paid tool calls, audio and video are included when billed by New API. The portal displays the recorded debit; it does not recalculate it as input + output minus cache.',
      'dash.history.packageConversion': 'The request cost is converted to package units using the terms fixed at purchase. The same number of model tokens can use different amounts of the package across models.',
      'dash.history.packageUnit': 'package units · per request',
      'dash.history.tokenUnit': 'tokens · per request',
      'dash.history.creditUnit': 'credits · per request',
      'dash.history.usdUnit': 'USD · per request',
      'dash.history.imageDebit': 'image',
      'dash.history.imageTool': 'Image generation',
      'dash.history.toolCall': 'Paid tool',
      'dash.t.modelTokens': 'Model tokens',
      'dash.t.time': 'Time',
      'dash.t.model': 'Model',
      'dash.t.input': 'Input',
      'dash.t.output': 'Output',
      'dash.t.cache': 'Cache',
      'dash.t.chargedTokens': 'Charged, tokens',
      'dash.t.chargedCredits': 'Charged, credits',
      'dash.t.chargedUsd': 'Charged, USD',
      'dash.t.status': 'Status',
      'noRequests': 'no requests',
      'err.empty': 'Enter your API key.',
      'err.invalid': 'Invalid or inactive API key.',
      'err.network': 'Could not reach the server. Try again later.',
      'err.logout': 'Could not close the protected session. Try logging out again.',
      'err.rateLimited': 'Request limit reached. Retry the login manually.',
      'err.rateLimitedWait': 'Too many requests. You can retry in {s}s…',
      'err.upstream': 'Provider temporarily unavailable. Your key is fine, try again later.',
      'copy.done': 'Copied!',
      'expires.prefix': 'until ',
      'daily': ' per day',
      'package': ' in package',
      'perCall': 'per call',
      'perM': 'per 1M',
      'credits': 'credits',
      'usd': 'USD',
      'tokens': 'tokens',
      'noData': 'no data',
      'noModels': '(no models available)',
      'status.ok': '✓ OK',
      'status.fail': '✕ failed',
      'theme.dark': 'Dark theme',
      'theme.light': 'Light theme',
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

  function getTheme() {
    return localStorage.getItem(THEME_KEY) === 'light' ? 'light' : 'dark';
  }

  function applyTheme(theme) {
    const selected = theme === 'light' ? 'light' : 'dark';
    document.documentElement.dataset.theme = selected;
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.content = selected === 'light' ? '#f4f6f8' : '#10141a';
    document.querySelectorAll('[data-theme-btn]').forEach((button) => {
      button.setAttribute('aria-pressed', button.getAttribute('data-theme-btn') === selected ? 'true' : 'false');
    });
  }

  function setTheme(theme) {
    const selected = theme === 'light' ? 'light' : 'dark';
    localStorage.setItem(THEME_KEY, selected);
    applyTheme(selected);
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
  // ANTHROPIC_SMALL_FAST_MODEL. Pointing that at Opus burns 5x the budget for
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
    document.querySelectorAll('[data-theme-label]').forEach((el) => {
      const label = t('theme.' + el.getAttribute('data-theme-label'));
      el.title = label;
      el.setAttribute('aria-label', label);
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
  function fmtPackageTokens(n) {
    const value = Number(n);
    if (!Number.isFinite(value)) return '—';
    return new Intl.NumberFormat(getLang() === 'ru' ? 'ru-RU' : 'en-US', {
      maximumFractionDigits: 0,
    }).format(Math.max(0, Math.round(value)));
  }
  function fmtUsd(n) {
    const value = Number(n);
    if (!Number.isFinite(value)) return '—';
    const digits = value > 0 && value < 0.01 ? 6 : 2;
    return '$' + new Intl.NumberFormat(getLang() === 'ru' ? 'ru-RU' : 'en-US', {
      minimumFractionDigits: 2,
      maximumFractionDigits: digits,
    }).format(Math.max(0, value));
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
        // A new login must re-read the token quota. The server still applies
        // its short per-key rate-limit guard when logins happen back-to-back.
        body: JSON.stringify({ key, refresh: true }),
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
          if (b && Number(b.retry_after) > 0) wait = Math.min(3600, Number(b.retry_after));
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

  // Keep the button disabled for the provider's real recovery window. The user
  // decides when to retry: an automatic request at the boundary can extend a
  // fixed-window limit before it has actually expired.
  let retryTimer = null;
  let dashboardTimer = null;
  function startRetryCountdown(btn, orig, seconds) {
    if (retryTimer) clearInterval(retryTimer);
    let left = Math.max(1, Math.round(seconds));
    btn.disabled = true;
    const tick = () => {
      if (left <= 0) {
        clearInterval(retryTimer);
        retryTimer = null;
        resetBtn(btn, orig);
        showErr(t('err.rateLimited'));
        return;
      }
      showErr(t('err.rateLimitedWait').replace('{s}', String(left)));
      btn.textContent = left + 's';
      left -= 1;
    };
    tick();
    retryTimer = setInterval(tick, 1000);
  }
  async function logout() {
    if (dashboardTimer) clearInterval(dashboardTimer);
    dashboardTimer = null;
    try {
      const response = await fetch('/api/portal/logout', { method: 'POST', keepalive: true });
      if (!response.ok) throw new Error('logout_failed');
    } catch (_) {
      showErr(t('err.logout'));
      startDashboardRefresh();
      return;
    }
    $('#dash').hidden = true;
    $('#login').style.display = 'flex';
    $('#key').value = '';
    window._lastData = null;
    window._lastKey = null;
    pricingData = null;
    statusData = null;
    window.scrollTo(0, 0);
  }


  // ---------------- models: id + status in one row ----------------
  // Pricing still supplies the catalog and its ordering; rates are not shown
  // in the key viewer. Status arrives independently and re-renders the list.
  const STATE_COLORS = {
    available: 'var(--ok)',
    degraded: 'var(--warn)',
    down: 'var(--bad)',
    unknown: 'var(--dim)',
  };

  let pricingData = null;
  let statusData = null;

  function renderModels() {
    const ul = $('#usageRates');
    const summary = $('#modelStatusSummary');
    if (!ul) return;
    const billingNote = $('#billingNote');
    if (billingNote) {
      const data = window._lastData || {};
      billingNote.textContent = t(data.billing_basis === 'panel_tariff_v1' ? 'dash.tariffBillingNote'
        : data.quota_mode === 'tokens' ? 'dash.rawBillingNote' : 'dash.walletBillingNote');
    }

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
      const input = x.input_usd;
      const perCall = x.per_call_usd;
      if (input != null) return Number(input);
      if (perCall != null) return Number(perCall);
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
        const m = stateBy.get(id);

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

  // The charged column follows the key's quota mode. Raw-token keys use the
  // settlement marker from `other`; wallet keys use the priced credit charge.
  function renderRequestTools(row) {
    const tools = Array.isArray(row.tool_surcharges) ? row.tool_surcharges : [];
    return tools.map((tool) => {
      const label = tool.name === 'image_generation'
        ? t('dash.history.imageTool')
        : `${t('dash.history.toolCall')}: ${tool.name}`;
      return `<span class="request-tool">${esc(label)} ×${fmt(tool.count)}</span>`;
    }).join('');
  }

  function renderToolDebit(row, usesPackageTariff) {
    if (!usesPackageTariff || !Array.isArray(row.tool_surcharges)) return '';
    const image = row.tool_surcharges.find((tool) => tool.name === 'image_generation');
    if (!image || !Number.isFinite(image.package_units)) return '';
    return `<small class="request-debit-detail">${t('dash.history.imageDebit')}: ${fmtPackageTokens(image.package_units)}</small>`;
  }

  function renderRecent() {
    const tbody = $('#recent');
    if (!tbody) return;
    const hasAnalytics = Boolean(window._lastData && window._lastData.analytics);
    const a = hasAnalytics ? window._lastData.analytics : {};
    const rec = a.recent || [];
    const usesTokenQuota = window._lastData && window._lastData.quota_mode === 'tokens';
    const usesPackageTariff = window._lastData?.billing_basis === 'panel_tariff_v1';
    let chargedLabel = 'dash.t.chargedCredits';
    let chargedUnit = 'dash.history.creditUnit';
    let historyNote = 'dash.history.creditNote';
    if (usesPackageTariff) {
      chargedLabel = 'dash.t.chargedPackage';
      chargedUnit = 'dash.history.packageUnit';
      historyNote = 'dash.history.packageNote';
    } else if (usesTokenQuota) {
      chargedLabel = 'dash.t.chargedTokens';
      chargedUnit = 'dash.history.tokenUnit';
      historyNote = 'dash.history.tokenNote';
    } else {
      chargedLabel = 'dash.t.chargedUsd';
      chargedUnit = 'dash.history.usdUnit';
      historyNote = 'dash.history.usdNote';
    }
    $('#chargedLabel').textContent = t(chargedLabel);
    $('#chargedUnit').textContent = t(chargedUnit);
    $('#requestUnitsNote').textContent = t(historyNote);
    $('#requestBillingNote').textContent = t(usesTokenQuota && !usesPackageTariff ? 'dash.rawBillingNote' : 'dash.history.tariff');
    $('#requestPackageNote').hidden = !usesPackageTariff;

    tbody.innerHTML =
      rec
        .slice(0, 50)
        .map((x) => {
          const ts = (x.ts || '').replace('T', ' ').slice(0, 16);
          const status = x.success
            ? `<span class="dot-ok">${t('status.ok')}</span>`
            : `<span class="dot-bad" title="${esc(x.error || '')}" style="cursor:help">${t('status.fail')}</span>`;

          const charged = usesTokenQuota ? x.charged_tokens : (x.usd ?? x.credits);
          return `<tr>
            <td class="mono muted">${esc(ts)}</td>
            <td class="mono"><span class="request-model">${esc(x.model)}</span>${renderRequestTools(x)}</td>
            <td class="mono">${fmtPackageTokens(x.input)}</td>
            <td class="mono">${fmtPackageTokens(x.output)}</td>
            <td class="mono">${x.cached ? fmtPackageTokens(x.cached) : '<span class="muted2">—</span>'}</td>
            <td class="mono request-debit"><span class="request-debit-main">${charged != null ? (usesTokenQuota ? fmtPackageTokens(charged) : fmtUsd(charged)) : '<span class="muted2">—</span>'}</span>${renderToolDebit(x, usesPackageTariff)}</td>
            <td>${status}</td>
          </tr>`;
        })
        .join('') || `<tr><td colspan="7" class="muted2">${hasAnalytics ? t('noRequests') : t('noData')}</td></tr>`;
  }

  async function refreshDashboard() {
    const key = window._lastKey || '';
    if (!window._lastData || document.hidden) return;
    try {
      const response = await fetch('/api/portal/me', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // Balance changes in New API should appear on the next dashboard tick,
        // rather than waiting for the server's five-minute snapshot TTL.
        body: JSON.stringify({ refresh: true }),
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
    const notice = $('#analyticsNotice');
    const usedSubEl = $('#usedSub');

    const usesTokenQuota = data.quota_mode === 'tokens';
    if (usedSubEl) usedSubEl.textContent = t(data.billing_basis === 'panel_tariff_v1' ? 'dash.usedPackageSub' : usesTokenQuota ? 'dash.usedTokenSub' : 'dash.usedUsdSub');

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
      tokEl.hidden = true;
      tokEl.textContent = cachedTok > 0
        ? t('dash.spentTokensCached').replace('{n}', fmt(spentTok)).replace('{c}', fmt(cachedTok))
        : t('dash.spentTokens').replace('{n}', fmt(spentTok));
    }

    const unitLabel = t('tokens');
    const chartTitle = $('#chartTitle');
    const byModelTitle = $('#byModelTitle');
    if (chartTitle) chartTitle.textContent = t('dash.tokens14') + ' · ' + unitLabel;
    if (byModelTitle) byModelTitle.textContent = t('dash.byModel') + ' · ' + unitLabel;

    const days = analytics.tokens_by_day || [];
    const valueOf = (item) => Number(item.tokens) || 0;
    const maxValue = Math.max(0.01, ...days.map(valueOf));
    $('#chart').innerHTML = days.map((item) => {
      const value = valueOf(item);
      const height = value > 0 ? Math.max(2, Math.round((value / maxValue) * 100)) : 0;
      const shown = fmt(value);
      return `<div class="col" title="${esc(item.date)}: ${esc(shown)} ${esc(unitLabel)}"><i style="height:${height}%"></i><span>${esc((item.date || '').slice(5))}</span></div>`;
    }).join('') || `<div class="muted2">${t('noData')}</div>`;

    const models = analytics.by_model || [];
    const modelMax = Math.max(0.01, ...models.map(valueOf));
    $('#byModel').innerHTML = models.map((item) => {
      const value = valueOf(item);
      const shown = fmt(value);
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
    const usesTokenQuota = d.quota_mode === 'tokens';
    const remainingLabel = d.billing_basis === 'panel_tariff_v1' ? 'dash.remainingPackage' : usesTokenQuota ? 'dash.remainingTokens' : 'dash.remainingUsd';
    const usedLabel = d.billing_basis === 'panel_tariff_v1' ? 'dash.usedPackageSub' : usesTokenQuota ? 'dash.usedTokenSub' : 'dash.usedUsdSub';
    const expiryLabel = d.billing_basis === 'panel_tariff_v1' ? 'dash.noExpiryPackage' : usesTokenQuota ? 'dash.noExpiryTokens' : 'dash.noExpiryUsd';
    const valueFor = (name) => {
      const raw = d[name + (usesTokenQuota ? '_tokens' : '_usd')];
      const parsed = Number(raw);
      return raw == null || !Number.isFinite(parsed) ? null : Math.max(0, parsed);
    };
    const limit = valueFor('limit') || 0;
    const used = valueFor('used') || 0;
    const explicitRemaining = valueFor('remaining');
    const remaining = explicitRemaining != null ? explicitRemaining : Math.max(0, limit - used);
    const held = valueFor('held') || 0;
    const formatBalance = usesTokenQuota ? fmtPackageTokens : fmtUsd;

    $('#keytag').textContent = d.key_hint || maskKey(key);
    $('#remaining').textContent = formatBalance(remaining);
    $('#remainingLabel').textContent = t(remainingLabel);
    // An unlimited key reports a zero/null limit, and a package of 0 is not a
    // number worth printing: substituting it left the literal "из —" on screen.
    // With no package there is also nothing to draw a progress bar against.
    const subEl = $('#remainingSub');
    const barWrap = $('#remainingBar') && $('#remainingBar').parentElement;
    if (limit > 0) {
      subEl.hidden = false;
      subEl.textContent = t('dash.ofPackage').replace('—', formatBalance(limit))
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

    $('#used').textContent = formatBalance(used);
    $('#usedSub').textContent = t(usedLabel);

    const holdEl = $('#remainingHold');
    if (held > 0) {
      holdEl.hidden = false;
      holdEl.style.color = 'var(--warn)';
      holdEl.textContent = t('held') + ': ' + formatBalance(held) + t('heldSuffix');
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
      expiryEl.textContent = t(expiryLabel);
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
    $('#remainingLabel').textContent = t(remainingLabel);
    $('#usedSub').textContent = t(usedLabel);
    if (limit > 0) {
      subEl.textContent = t('dash.ofPackage').replace('—', formatBalance(limit))
        + (d.balance_mode === 'daily' ? t('daily') : t('package'));
    }
    if (!d.expires_at) expiryEl.textContent = t(expiryLabel);
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
    document.querySelectorAll('[data-theme-btn]').forEach((b) =>
      b.addEventListener('click', () => setTheme(b.getAttribute('data-theme-btn'))),
    );
  }

  // ---------------- init ----------------
  async function init() {
    applyTheme(getTheme());

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
    bindEvents();
    loadNews();

    // Restore only the opaque HttpOnly portal session. The API key itself is
    // never persisted in browser storage.
    try {
      const response = await fetch('/api/portal/me', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      });
      if (response.ok) {
        render(await response.json(), '');
        startDashboardRefresh();
      }
    } catch (_) { /* show the login form */ }
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden && window._lastData) refreshDashboard();
    });
  }

  document.addEventListener('DOMContentLoaded', init);
})();
