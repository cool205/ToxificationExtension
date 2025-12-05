(function(){
  const defaults = {
    TOXIC_CONFIDENCE_THRESHOLD: 99.0,
    BATCH_DELAY: 100,
    MAX_BATCH_SIZE: 8,
    DETOX_CONCURRENCY: 4,
    CACHE_TTL_MINUTES: 60,
    LOG_CAP: 500
  };

  // Slider mapping settings for the accuracy threshold
  const THRESHOLD_MIN = 80.0;
  const THRESHOLD_MAX = 99.9;
  const SLIDER_MAX = 1000; // slider 0..1000 for fine control
  const THRESH_EXP = 4; // exponent used to skew slider towards high end

  function sliderToThreshold(sliderVal) {
    const t = Number(sliderVal) / SLIDER_MAX; // 0..1
    // skew towards high values: use 1 - (1 - t)^exp interpolation
    const frac = 1 - Math.pow(1 - t, THRESH_EXP);
    return THRESHOLD_MIN + frac * (THRESHOLD_MAX - THRESHOLD_MIN);
  }

  function thresholdToSlider(threshold) {
    const clamped = Math.max(THRESHOLD_MIN, Math.min(THRESHOLD_MAX, Number(threshold)));
    const frac = (clamped - THRESHOLD_MIN) / (THRESHOLD_MAX - THRESHOLD_MIN);
    const t = 1 - Math.pow(1 - frac, 1 / THRESH_EXP);
    return Math.round(t * SLIDER_MAX);
  }

  const els = {
    threshold: document.getElementById('threshold'),
    thresholdVal: document.getElementById('thresholdVal'),
    batchDelay: document.getElementById('batchDelay'),
    batchDelayVal: document.getElementById('batchDelayVal'),
    batchSize: document.getElementById('batchSize'),
    batchSizeVal: document.getElementById('batchSizeVal'),
    concurrency: document.getElementById('concurrency'),
    concurrencyVal: document.getElementById('concurrencyVal'),
    cacheTtl: document.getElementById('cacheTtl'),
    cacheTtlVal: document.getElementById('cacheTtlVal'),
    logCap: document.getElementById('logCap'),
    logCapVal: document.getElementById('logCapVal'),
    saveBtn: document.getElementById('saveBtn'),
    resetBtn: document.getElementById('resetBtn'),
    clearCacheBtn: document.getElementById('clearCacheBtn'),
    blockMode: document.getElementById('blockMode'),
    status: document.getElementById('status')
  };

  function setValuesFrom(settings){
    // threshold slider uses skewed mapping for fine control at high values
    const thr = (settings.TOXIC_CONFIDENCE_THRESHOLD != null) ? Number(settings.TOXIC_CONFIDENCE_THRESHOLD) : defaults.TOXIC_CONFIDENCE_THRESHOLD;
    els.threshold.value = thresholdToSlider(thr);
    els.thresholdVal.textContent = sliderToThreshold(els.threshold.value).toFixed(1);
    els.batchDelay.value = settings.BATCH_DELAY;
    els.batchDelayVal.textContent = settings.BATCH_DELAY;
    els.batchSize.value = settings.MAX_BATCH_SIZE;
    els.batchSizeVal.textContent = settings.MAX_BATCH_SIZE;
    els.concurrency.value = settings.DETOX_CONCURRENCY;
    els.concurrencyVal.textContent = settings.DETOX_CONCURRENCY;
    els.cacheTtl.value = settings.CACHE_TTL_MINUTES;
    els.cacheTtlVal.textContent = settings.CACHE_TTL_MINUTES;
    els.logCap.value = settings.LOG_CAP;
    els.logCapVal.textContent = settings.LOG_CAP;
    // blocking mode
    els.blockMode.value = settings.BLOCK_MODE || 'colormatch';
  }

  function readInputs(){
    return {
      TOXIC_CONFIDENCE_THRESHOLD: Number(sliderToThreshold(els.threshold.value).toFixed(1)),
      BATCH_DELAY: Number(els.batchDelay.value),
      MAX_BATCH_SIZE: Number(els.batchSize.value),
      DETOX_CONCURRENCY: Number(els.concurrency.value),
      CACHE_TTL_MINUTES: Number(els.cacheTtl.value),
      LOG_CAP: Number(els.logCap.value),
      BLOCK_MODE: els.blockMode.value
    };
  }

  function save(settings){
    return new Promise((resolve) => {
      try{
        chrome.storage.local.set({ extSettings: settings }, () => { resolve(); });
      }catch(e){ resolve(); }
    });
  }

  function load(){
    return new Promise((resolve) => {
      try{
        chrome.storage.local.get(['extSettings'], (res) => {
          resolve(res.extSettings || defaults);
        });
      }catch(e){ resolve(defaults); }
    });
  }

  // wire sliders to display
  // threshold needs a special mapping
  els.threshold.addEventListener('input', () => {
    els.thresholdVal.textContent = sliderToThreshold(els.threshold.value).toFixed(1);
  });
  ['batchDelay','batchSize','concurrency','cacheTtl','logCap'].forEach(id => {
    const el = document.getElementById(id);
    const val = document.getElementById(id + 'Val');
    el.addEventListener('input', () => { val.textContent = el.value; });
  });

  els.saveBtn.addEventListener('click', async () => {
    const cfg = readInputs();
    await save(cfg);
    els.status.textContent = 'Saved.';
    setTimeout(()=> els.status.textContent = '', 2000);
  });

  els.resetBtn.addEventListener('click', async () => {
    const ok = confirm('Reset settings to defaults?');
    if (!ok) return;
    // Ask background to reset settings and clear persisted caches
    chrome.runtime.sendMessage({ type: 'resetSettings' }, (resp) => {
      // update UI regardless
      setValuesFrom(defaults);
      els.status.textContent = resp && resp.success ? 'Defaults restored.' : 'Reset attempted.';
      setTimeout(()=> els.status.textContent = '', 2000);
    });
  });

  els.clearCacheBtn.addEventListener('click', async () => {
    const ok = confirm('Clear classification and detox caches? This cannot be undone.');
    if (!ok) return;
    chrome.runtime.sendMessage({ type: 'clearCaches' }, (resp) => {
      if (resp && resp.success) {
        els.status.textContent = 'Caches cleared.';
      } else {
        els.status.textContent = 'Clear cache failed.';
      }
      setTimeout(()=> els.status.textContent = '', 2000);
    });
  });

  // initialize UI
  (async ()=>{
    const s = await load();
    // convert minutes TTL to minutes stored
    s.CACHE_TTL_MINUTES = s.CACHE_TTL_MINUTES || defaults.CACHE_TTL_MINUTES;
    // ensure threshold default available
    if (s.TOXIC_CONFIDENCE_THRESHOLD == null) s.TOXIC_CONFIDENCE_THRESHOLD = defaults.TOXIC_CONFIDENCE_THRESHOLD;
    setValuesFrom(Object.assign({}, defaults, s));
  })();
})();
