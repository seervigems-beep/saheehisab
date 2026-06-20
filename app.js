'use strict';

// ── State ──────────────────────────────────────────────────────────────────────

var state = {
  selectedFile   : null,
  invoiceFile    : null,
  lastResult     : null,
  identifiedImage: null,   // base64 after Step 1
  stoneRowCount  : 0,
};

// ── Tab Switching ──────────────────────────────────────────────────────────────

document.querySelectorAll('.tab').forEach(function(tab) {
  tab.addEventListener('click', function() {
    document.querySelectorAll('.tab').forEach(function(t) { t.classList.remove('active'); t.setAttribute('aria-selected','false'); });
    tab.classList.add('active'); tab.setAttribute('aria-selected','true');
    document.querySelectorAll('.panel').forEach(function(p) { p.classList.remove('active'); });
    document.getElementById(tab.dataset.target).classList.add('active');
    hideResult(); hideError();
  });
});

// ── URL Analysis ───────────────────────────────────────────────────────────────

async function analyseUrl() {
  var url = document.getElementById('product-url').value.trim();
  if (!url) { showError('Please enter a product URL.'); return; }
  if (!isValidHttpUrl(url)) { showError('Please enter a valid HTTP or HTTPS URL.'); return; }
  showLoader('Fetching product details…'); hideError(); hideResult();
  try {
    var res  = await fetch('/analyse-product', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ url: url }) });
    var json = await res.json();
    if (!json.success) throw new Error(json.error || 'Analysis failed.');
    renderResult(json);
  } catch(err) { showError(err.message || 'Network error.'); }
  finally { hideLoader(); }
}

document.getElementById('product-url').addEventListener('keydown', function(e) {
  if (e.key === 'Enter') analyseUrl();
});

// ── OPTION A: Photo Upload ─────────────────────────────────────────────────────

function handleFileSelect(event) {
  var file = event.target.files[0];
  if (file) loadJewelleryFile(file);
}

function loadJewelleryFile(file) {
  state.selectedFile = file;
  var reader = new FileReader();
  reader.onload = function(e) {
    document.getElementById('preview-img').src = e.target.result;
    document.getElementById('upload-zone').classList.add('hidden');
    document.getElementById('upload-preview').classList.remove('hidden');
    document.getElementById('btn-identify-img').disabled = false;
  };
  reader.readAsDataURL(file);
}

function clearImage() {
  state.selectedFile = null;
  state.identifiedImage = null;
  document.getElementById('file-input').value = '';
  document.getElementById('preview-img').src = '';
  document.getElementById('upload-zone').classList.remove('hidden');
  document.getElementById('upload-preview').classList.add('hidden');
  document.getElementById('btn-identify-img').disabled = true;
  document.getElementById('manual-form').classList.add('hidden');
  hideResult();
}

// Drag and drop for jewellery photo
var uploadZone = document.getElementById('upload-zone');
uploadZone.addEventListener('dragover', function(e) { e.preventDefault(); uploadZone.style.borderColor = 'var(--gold)'; });
uploadZone.addEventListener('dragleave', function() { uploadZone.style.borderColor = ''; });
uploadZone.addEventListener('drop', function(e) {
  e.preventDefault(); uploadZone.style.borderColor = '';
  var file = e.dataTransfer.files[0];
  if (file && file.type.startsWith('image/')) loadJewelleryFile(file);
});

// Step 1: Send photo to AI for identification only
async function identifyFromImage() {
  if (!state.selectedFile) { showError('Please select a jewellery photo first.'); return; }
  showLoader('AI is identifying the jewellery…'); hideError(); hideResult();
  try {
    var formData = new FormData();
    formData.append('image', state.selectedFile);
    var res  = await fetch('/identify-image', { method:'POST', body: formData });
    var json = await res.json();
    if (!json.success) throw new Error(json.error || 'Could not identify jewellery.');

    state.identifiedImage = json.image;
    populateManualForm(json.identified);
    document.getElementById('manual-form').classList.remove('hidden');
    document.getElementById('manual-form').scrollIntoView({ behavior:'smooth', block:'start' });

  } catch(err) { showError(err.message); }
  finally { hideLoader(); }
}

function populateManualForm(identified) {
  // Set jewellery type dropdown
  var typeEl = document.getElementById('mf-jewellery-type');
  var type   = (identified.jewellery_type || 'plain').toLowerCase();
  for (var i = 0; i < typeEl.options.length; i++) {
    if (typeEl.options[i].value === type) { typeEl.selectedIndex = i; break; }
  }

  // Set purity
  var purityEl = document.getElementById('mf-purity');
  var purity   = identified.purity || '22K';
  for (var j = 0; j < purityEl.options.length; j++) {
    if (purityEl.options[j].value === purity) { purityEl.selectedIndex = j; break; }
  }

  // Set estimated gold weight as placeholder hint
  var gwEl = document.getElementById('mf-gold-weight');
  if (identified.estimated_gold_weight) {
    gwEl.placeholder = 'AI estimate: ' + identified.estimated_gold_weight + 'g (enter exact weight)';
  }

  // Show AI note
  var noteEl = document.getElementById('ai-note');
  var noteText = identified.ai_notes || '';
  if (identified.confidence) { noteText += ' (Confidence: ' + identified.confidence + ')'; }
  if (noteText) {
    noteEl.textContent = '🤖 ' + noteText;
    noteEl.classList.remove('hidden');
  }

  // Pre-fill stone rows from identified stones
  document.getElementById('stone-rows').innerHTML = '';
  state.stoneRowCount = 0;
  if (identified.stones && identified.stones.length) {
    identified.stones.forEach(function(s) {
      addStoneRow(s.stone_type, s.estimated_weight, s.weight_unit);
    });
  } else {
    addStoneRow(); // At least one empty row
  }
}

// Add a stone input row
function addStoneRow(stoneType, weight, weightUnit) {
  state.stoneRowCount++;
  var id  = state.stoneRowCount;
  var row = document.createElement('div');
  row.className = 'stone-input-row';
  row.id        = 'stone-row-' + id;

  var stoneTypes = ['Diamond','Polki','Ruby','Emerald','Sapphire','Pearl','Coral','Turquoise','Opal','Amethyst','Topaz','Garnet','Spinel','Other'];
  var opts = stoneTypes.map(function(t) {
    return '<option value="' + t + '"' + (stoneType === t ? ' selected' : '') + '>' + t + '</option>';
  }).join('');

  row.innerHTML =
    '<select class="stone-type-sel" data-id="' + id + '">' + opts + '</select>' +
    '<input type="number" class="stone-weight-inp" data-id="' + id + '" placeholder="Weight" value="' + (weight || '') + '" min="0" step="0.01" />' +
    '<select class="stone-unit-sel" data-id="' + id + '">' +
      '<option value="carat"' + (weightUnit === 'carat' ? ' selected' : '') + '>carat</option>' +
      '<option value="gram"' + (weightUnit === 'gram' ? ' selected' : '') + '>gram</option>' +
    '</select>' +
    '<input type="number" class="stone-site-price-inp" data-id="' + id + '" placeholder="Website price (₹)" min="0" step="1" />' +
    '<button class="btn-remove-stone" onclick="removeStoneRow(' + id + ')">✕</button>';

  document.getElementById('stone-rows').appendChild(row);
}

function removeStoneRow(id) {
  var row = document.getElementById('stone-row-' + id);
  if (row) row.remove();
}

// Step 2: Calculate from manual inputs
async function calculateManual() {
  var goldWeight   = parseFloat(document.getElementById('mf-gold-weight').value) || 0;
  var websitePrice = parseFloat(document.getElementById('mf-website-price').value) || 0;
  var purity       = document.getElementById('mf-purity').value;
  var jewType      = document.getElementById('mf-jewellery-type').value;

  if (goldWeight <= 0) { showError('Please enter the gold weight in grams.'); return; }

  // Collect stone rows
  var stones = [];
  document.querySelectorAll('.stone-input-row').forEach(function(row) {
    var id        = row.querySelector('.stone-type-sel').dataset.id;
    var stoneType = row.querySelector('.stone-type-sel').value;
    var weight    = parseFloat(row.querySelector('.stone-weight-inp').value) || 0;
    var unit      = row.querySelector('.stone-unit-sel').value;
    var sitePrice = parseFloat(row.querySelector('.stone-site-price-inp').value) || 0;
    if (weight > 0) {
      stones.push({ stone_type: stoneType, weight: weight, weight_unit: unit, website_stone_value: sitePrice });
    }
  });

  showLoader('Calculating price…'); hideError(); hideResult();
  try {
    var payload = {
      product_name  : 'Jewellery (Photo Analysis)',
      metal         : 'Gold',
      purity        : purity,
      jewellery_type: jewType,
      gold_weight   : goldWeight,
      website_price : websitePrice,
      stones        : stones,
    };
    var res  = await fetch('/calculate-manual', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(payload) });
    var json = await res.json();
    if (!json.success) throw new Error(json.error || 'Calculation failed.');

    renderResult({ success: true, image: state.identifiedImage || '', data: json.data });
  } catch(err) { showError(err.message); }
  finally { hideLoader(); }
}

// ── OPTION B: Invoice / Bill Reader ──────────────────────────────────────────

function handleInvoiceSelect(event) {
  var file = event.target.files[0];
  if (file) loadInvoiceFile(file);
}

function loadInvoiceFile(file) {
  state.invoiceFile = file;
  var reader = new FileReader();
  reader.onload = function(e) {
    document.getElementById('invoice-preview-img').src = e.target.result;
    document.getElementById('invoice-upload-zone').classList.add('hidden');
    document.getElementById('invoice-preview').classList.remove('hidden');
    document.getElementById('btn-analyse-invoice').disabled = false;
  };
  reader.readAsDataURL(file);
}

function clearInvoice() {
  state.invoiceFile = null;
  document.getElementById('invoice-file-input').value = '';
  document.getElementById('invoice-preview-img').src = '';
  document.getElementById('invoice-upload-zone').classList.remove('hidden');
  document.getElementById('invoice-preview').classList.add('hidden');
  document.getElementById('btn-analyse-invoice').disabled = true;
  hideResult();
}

// Drag and drop for invoice
var invoiceZone = document.getElementById('invoice-upload-zone');
invoiceZone.addEventListener('dragover', function(e) { e.preventDefault(); invoiceZone.style.borderColor = 'var(--gold)'; });
invoiceZone.addEventListener('dragleave', function() { invoiceZone.style.borderColor = ''; });
invoiceZone.addEventListener('drop', function(e) {
  e.preventDefault(); invoiceZone.style.borderColor = '';
  var file = e.dataTransfer.files[0];
  if (file && file.type.startsWith('image/')) loadInvoiceFile(file);
});

async function analyseInvoice() {
  if (!state.invoiceFile) { showError('Please select a bill or invoice image first.'); return; }
  showLoader('Reading bill — AI is extracting all numbers…'); hideError(); hideResult();
  try {
    var formData = new FormData();
    formData.append('image', state.invoiceFile);
    var res  = await fetch('/analyse-invoice', { method:'POST', body: formData });
    var json = await res.json();
    if (!json.success) throw new Error(json.error || 'Could not read the invoice.');
    renderResult(json);
  } catch(err) { showError(err.message); }
  finally { hideLoader(); }
}

// ── Render Result ──────────────────────────────────────────────────────────────

function renderResult(json) {
  var data  = json.data;
  var image = json.image;
  state.lastResult = json;
  state.shareId    = json.share_id || null;

  // Image
  var imgEl   = document.getElementById('result-img');
  var imgWrap = imgEl.parentElement;
  if (image) {
    imgEl.src           = image;
    imgEl.style.display = 'block';
    imgEl.onerror       = function() { imgWrap.innerHTML = '<div class="product-img-placeholder">◆</div>'; };
  } else {
    imgWrap.innerHTML = '<div class="product-img-placeholder">◆</div>';
  }

  // Meta
  document.getElementById('result-jewellery-type').textContent = data.jewellery_type || 'Jewellery';
  document.getElementById('result-name').textContent           = data.product_name   || 'Product';
  setChip('chip-metal',  data.metal   || '–');
  setChip('chip-purity', data.purity  || '–');
  var gw = parseFloat(data.gold_weight) || 0;
  if (gw > 0) {
    setChip('chip-weight', gw + 'g Gold');
    document.getElementById('weight-input-box').classList.add('hidden');
  } else {
    document.getElementById('chip-weight').classList.add('hidden');
    // Only show weight box if we truly can't calculate
    // If we have gold_value + gold_rate → weight = value/rate (no input needed)
    // Show weight box only if we truly have no weight AND no way to calculate
    var hasWeight    = parseFloat(data.gold_weight) > 0;
    var hasGoldValue = parseFloat(data.website_gold_value) > 0;
    var hasSaheehisabPrice = parseFloat(data.saheehisab_price) > 0;

    // If we have saheehisab price calculated = weight was found, no box needed
    if (hasWeight || hasSaheehisabPrice) {
      return; // pricing is complete, just display
    }

    document.getElementById('weight-input-box').classList.remove('hidden');
    // Update hint with context
    var storePrice = parseFloat(data.website_price);
    var hintEl = document.querySelector('.weight-input-box p:last-child');
    if (hintEl && storePrice > 0) {
      hintEl.textContent = 'Store price (₹' + Math.round(storePrice).toLocaleString('en-IN') + ') is captured. Add weight for full comparison.';
    }
    document.getElementById('manual-weight-input').value = '';
    setTimeout(function() {
      document.getElementById('manual-weight-input').focus();
    }, 300);
  }
  var mkEl = document.getElementById('chip-making');
  if (mkEl) { mkEl.textContent = 'Making ' + data.saheehisab_making_percent + '%'; mkEl.classList.remove('hidden'); }

  // AI / invoice notes
  var noteEl = document.getElementById('ai-note');
  var noteText = data.ai_notes || '';
  if (data.shop_name)       noteText = '🏪 ' + data.shop_name + (data.invoice_date ? ' · ' + data.invoice_date : '') + ' · ' + noteText;
  if (data.invoice_number)  noteText += '  Invoice #' + data.invoice_number;
  if (noteText.trim()) { noteEl.textContent = noteText; noteEl.classList.remove('hidden'); }
  else { noteEl.classList.add('hidden'); }

  renderStoneSection(data);
  renderCompareTable(data);
  renderSavings(data);

  document.getElementById('result').classList.remove('hidden');
  setTimeout(function() { document.getElementById('result').scrollIntoView({ behavior:'smooth', block:'start' }); }, 100);
}

function setChip(id, text) {
  var el = document.getElementById(id);
  if (!el) return;
  if (!text || text === '–' || text === '0') { el.classList.add('hidden'); return; }
  el.textContent = text; el.classList.remove('hidden');
}

function renderStoneSection(data) {
  var section = document.getElementById('stone-section');
  var tbody   = document.getElementById('stone-body');
  var stones  = (data.stone_breakdown || []).filter(function(s) {
    return parseFloat(s.weight) > 0; // hide stones with 0 weight
  });
  if (!stones.length) { section.classList.add('hidden'); return; }
  section.classList.remove('hidden');

  tbody.innerHTML = stones.map(function(s) {
    var unit      = s.weight_unit || 'ct';
    var fmtW      = s.weight + ' ' + unit;
    var siteRateN = parseFloat(s.website_rate_per_unit) || 0;
    var siteValN  = parseFloat(s.website_stone_value)   || 0;
    var weight    = parseFloat(s.weight) || 0;

    // If rate missing but value and weight exist — calculate rate
    if (siteRateN === 0 && siteValN > 0 && weight > 0) {
      siteRateN = Math.round(siteValN / weight);
    }
    // If value missing but rate and weight exist — calculate value
    if (siteValN === 0 && siteRateN > 0 && weight > 0) {
      siteValN = siteRateN * weight;
    }

    var siteRate  = siteRateN > 0 ? '₹' + Math.round(siteRateN).toLocaleString('en-IN') + '/' + unit : '—';
    var siteVal   = siteValN  > 0 ? '₹' + siteValN.toLocaleString('en-IN', { minimumFractionDigits:2, maximumFractionDigits:2 }) : '—';
    var ourRate   = '₹' + Number(s.rate).toLocaleString('en-IN') + '/' + unit;
    var ourVal    = '₹' + Number(s.value).toLocaleString('en-IN', { minimumFractionDigits:2, maximumFractionDigits:2 });
    return '<tr><td>' + (s.stone_type||'Stone') + '</td><td>' + fmtW + '</td><td>' + siteRate + '</td><td>' + ourRate + '</td><td>' + siteVal + '</td><td class="col-saheehisab">' + ourVal + '</td></tr>';
  }).join('');
}

function renderCompareTable(data) {
  var fmt = function(val) {
    var n = parseFloat(val);
    if (!n || isNaN(n)) return '—';
    return '₹' + n.toLocaleString('en-IN', { minimumFractionDigits:2, maximumFractionDigits:2 });
  };

  // Website stone value
  var websiteStoneVal = 0;
  if (data.website_stone_value && parseFloat(data.website_stone_value) > 0) {
    websiteStoneVal = parseFloat(data.website_stone_value);
  } else if (data.stone_breakdown && data.stone_breakdown.length) {
    data.stone_breakdown.forEach(function(s) { websiteStoneVal += parseFloat(s.website_stone_value) || 0; });
  }
  var websiteStoneDisplay = websiteStoneVal > 0 ? fmt(websiteStoneVal.toFixed(2)) : '—';

  var makingPct = parseFloat(data.website_making_percent) || 0;
  var rows = [
    { label: 'Gold Rate (per gram)', site: fmt(data.website_gold_rate),    saheeh: fmt(data.saheehisab_gold_rate), siteLabel: 'Store Rate'    },
    { label: 'Gold Value',           site: fmt(data.website_gold_value),   saheeh: fmt(data.saheehisab_gold_value)   },
    { label: 'Stone / Diamond Value',site: websiteStoneDisplay,            saheeh: fmt(data.saheehisab_stone_value)  },
    { label: 'Making Charge',        site: fmt(data.website_making_charge) + (makingPct > 0 ? ' (' + makingPct + '%)' : ''), saheeh: fmt(data.saheehisab_making_charge) + ' (' + data.saheehisab_making_percent + '%)' },
    { label: 'GST (3%)',             site: fmt(data.website_gst),           saheeh: fmt(data.saheehisab_gst)          },
    { label: 'Total Price',
      site: fmt(data.website_price),
      saheeh: parseFloat(data.saheehisab_price) > 0
        ? fmt(data.saheehisab_price)
        : '<span style="font-size:11px;color:#E8943A">Enter gold weight above to calculate</span>',
      isTotal: true
    },
  ];

  document.getElementById('compare-body').innerHTML = rows.map(function(r) {
    return '<tr class="' + (r.isTotal ? 'row-total' : '') + '"><td class="row-label">' + r.label + '</td><td>' + r.site + '</td><td class="col-saheehisab">' + r.saheeh + '</td></tr>';
  }).join('');
}

function renderSavings(data) {
  var savings  = parseFloat(data.estimated_savings) || 0;
  var card     = document.getElementById('savings-card');
  var amountEl = document.getElementById('savings-amount');
  var subEl    = document.getElementById('savings-sub');
  var fmtMoney = function(v) { return '₹' + Math.abs(v).toLocaleString('en-IN', { minimumFractionDigits:0, maximumFractionDigits:0 }); };

  if (savings > 0) {
    card.classList.remove('negative');
    amountEl.textContent = 'You Save ' + fmtMoney(savings);
    subEl.textContent    = 'Compared to the store\'s quoted price';
  } else if (savings < 0) {
    card.classList.add('negative');
    amountEl.textContent = 'Saheehisab is ' + fmtMoney(savings) + ' more';
    subEl.textContent    = 'This product is priced lower elsewhere — verify before buying';
  } else {
    card.classList.remove('negative');
    amountEl.textContent = 'Similar Pricing';
    subEl.textContent    = 'Price is comparable to Saheehisab rates';
  }
}

// ── Rates Panel ────────────────────────────────────────────────────────────────

var RATE_FIELDS = [
  { key:'gold_24k',   label:'Gold 24K',    prefix:'₹', suffix:'per gram', section:'gold'   },
  { key:'gold_22k',   label:'Gold 22K',    prefix:'₹', suffix:'per gram', section:'gold'   },
  { key:'gold_18k',   label:'Gold 18K',    prefix:'₹', suffix:'per gram', section:'gold'   },
  { key:'gold_14k',   label:'Gold 14K',    prefix:'₹', suffix:'per gram', section:'gold'   },
  { key:'silver',     label:'Silver',      prefix:'₹', suffix:'per gram', section:'metal'  },
  { key:'platinum',   label:'Platinum',    prefix:'₹', suffix:'per gram', section:'metal'  },
  { key:'diamond',    label:'Diamond',     prefix:'₹', suffix:'per carat',section:'stone'  },
  { key:'polki',      label:'Polki',       prefix:'₹', suffix:'per carat',section:'stone'  },
  { key:'ruby',       label:'Ruby',        prefix:'₹', suffix:'per carat',section:'stone'  },
  { key:'emerald',    label:'Emerald',     prefix:'₹', suffix:'per carat',section:'stone'  },
  { key:'sapphire',   label:'Sapphire',    prefix:'₹', suffix:'per carat',section:'stone'  },
  { key:'pearl',      label:'Pearl',       prefix:'₹', suffix:'per gram', section:'stone'  },
  { key:'coral',      label:'Coral',       prefix:'₹', suffix:'per gram', section:'stone'  },
  { key:'turquoise',  label:'Turquoise',   prefix:'₹', suffix:'per gram', section:'stone'  },
  { key:'opal',       label:'Opal',        prefix:'₹', suffix:'per carat',section:'stone'  },
  { key:'amethyst',   label:'Amethyst',    prefix:'₹', suffix:'per carat',section:'stone'  },
  { key:'topaz',      label:'Topaz',       prefix:'₹', suffix:'per carat',section:'stone'  },
  { key:'garnet',     label:'Garnet',      prefix:'₹', suffix:'per carat',section:'stone'  },
  { key:'spinel',     label:'Spinel',      prefix:'₹', suffix:'per carat',section:'stone'  },
  { key:'other_stone',label:'Other Stone', prefix:'₹', suffix:'per gram', section:'stone'  },
  { key:'making_chain',   label:'Chain',         suffix:'%', section:'making' },
  { key:'making_ring',    label:'Ring',          suffix:'%', section:'making' },
  { key:'making_necklace',label:'Necklace',      suffix:'%', section:'making' },
  { key:'making_pendant', label:'Pendant',       suffix:'%', section:'making' },
  { key:'making_bangle',  label:'Bangle',        suffix:'%', section:'making' },
  { key:'making_earrings',label:'Earrings',      suffix:'%', section:'making' },
  { key:'making_jhumka',  label:'Jhumka',        suffix:'%', section:'making' },
  { key:'making_temple',  label:'Temple',        suffix:'%', section:'making' },
  { key:'making_kundan',  label:'Kundan',        suffix:'%', section:'making' },
  { key:'making_bracelet',label:'Bracelet',      suffix:'%', section:'making' },
  { key:'making_anklet',  label:'Anklet',        suffix:'%', section:'making' },
  { key:'making_plain',   label:'Plain/Default', suffix:'%', section:'making' },
];

function buildRatesPanel(rates) {
  var body = document.getElementById('rates-body');
  var sections = {
    gold  : { label:'🥇 Gold Rates (per gram)',        fields:[] },
    metal : { label:'⚪ Other Metals (per gram)',        fields:[] },
    stone : { label:'💎 Stone Rates',                   fields:[] },
    making: { label:'🔨 Making Charges (% of gold)',    fields:[] },
  };
  RATE_FIELDS.forEach(function(f) { sections[f.section].fields.push(f); });

  body.innerHTML = Object.keys(sections).map(function(k) {
    var sec = sections[k];
    var fieldsHtml = sec.fields.map(function(f) {
      var val = rates[f.key] !== undefined ? rates[f.key] : '';
      return '<div class="rp-field">' +
        '<label>' + f.label + (f.suffix ? ' <span class="rp-unit">(' + f.suffix + ')</span>' : '') + '</label>' +
        '<div class="rp-input-wrap">' +
        (f.prefix ? '<span class="rp-prefix">' + f.prefix + '</span>' : '') +
        '<input type="number" id="rp_' + f.key + '" value="' + val + '" min="0" step="' + (f.suffix === '%' ? '0.5' : '1') + '" />' +
        '</div></div>';
    }).join('');
    return '<div class="rp-section"><h3>' + sec.label + '</h3><div class="rp-grid">' + fieldsHtml + '</div></div>';
  }).join('');

  body.querySelectorAll('input').forEach(function(el) {
    el.addEventListener('keydown', function(e) { if (e.key === 'Enter') saveRates(); });
  });
}

async function toggleRatesPanel() {
  var panel   = document.getElementById('rates-panel');
  var overlay = document.getElementById('rates-overlay');
  if (panel.classList.contains('hidden')) {
    panel.classList.remove('hidden'); overlay.classList.remove('hidden');
    try {
      var res  = await fetch('/rates');
      var json = await res.json();
      if (json.success) buildRatesPanel(json.rates);
    } catch(e) { document.getElementById('rates-body').innerHTML = '<p style="color:var(--red-err)">Failed to load rates.</p>'; }
  } else { closeRatesPanel(); }
}

function closeRatesPanel() {
  document.getElementById('rates-panel').classList.add('hidden');
  document.getElementById('rates-overlay').classList.add('hidden');
}

async function saveRates() {
  var payload = {};
  RATE_FIELDS.forEach(function(f) {
    var el = document.getElementById('rp_' + f.key);
    if (el && el.value !== '') payload[f.key] = parseFloat(el.value);
  });
  try {
    var res  = await fetch('/rates', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(payload) });
    var json = await res.json();
    if (!json.success) throw new Error('Save failed');
    showToast('✓ Rates saved!');
  } catch(err) { showToast('✗ ' + err.message); }
}

async function resetRates() {
  if (!confirm('Reset all rates to .env defaults?')) return;
  try {
    var res  = await fetch('/rates', { method:'DELETE' });
    var json = await res.json();
    if (json.success) { buildRatesPanel(json.rates); showToast('Rates reset to defaults'); }
  } catch(err) { showToast('Reset failed: ' + err.message); }
}

// ── Share ──────────────────────────────────────────────────────────────────────

function shareWhatsApp() {
  if (!state.lastResult) return;
  var d       = state.lastResult.data;
  var savings = parseFloat(d.estimated_savings) || 0;
  var stoneTxt = '';
  if (d.stone_breakdown && d.stone_breakdown.length) {
    stoneTxt = '\nStones: ' + d.stone_breakdown.map(function(s) { return s.stone_type + ' ' + s.weight + (s.weight_unit||'ct'); }).join(', ');
  }

  // Use share link (shows product image in WhatsApp preview)
  var shareLink = state.shareId
    ? window.location.origin + '/share/' + state.shareId
    : window.location.href;

  var msg = encodeURIComponent(
    '*Saheehisab AI Price Check* 💎\n\n' +
    '*Product:* ' + (d.product_name || 'Jewellery') + '\n' +
    '*Type:* ' + (d.jewellery_type || '') + stoneTxt + '\n' +
    '*Metal:* ' + (d.metal || '') + ' ' + (d.purity || '') + '\n' +
    (d.gold_weight && parseFloat(d.gold_weight) > 0 ? '*Weight:* ' + d.gold_weight + 'g\n' : '') +
    '\n*Store Price:* Rs.' + parseFloat(d.website_price || 0).toLocaleString('en-IN') + '\n' +
    '*Saheehisab Price:* Rs.' + parseFloat(d.saheehisab_price || 0).toLocaleString('en-IN') + '\n' +
    (savings > 0 ? '\n*You Save Rs.' + Math.round(savings).toLocaleString('en-IN') + ' with Saheehisab!* 🎉' : '') +
    '\n\n📸 View full details with product image:\n' + shareLink
  );
  window.open('https://wa.me/?text=' + msg, '_blank');
}

async function shareNative() {
  var shareLink = state.shareId
    ? window.location.origin + '/share/' + state.shareId
    : window.location.href;
  if (!navigator.share || !state.lastResult) { copyToClipboard(shareLink); return; }
  var d = state.lastResult.data;
  try {
    await navigator.share({
      title: 'Saheehisab AI — ' + (d.product_name || 'Jewellery Price Check'),
      text : 'Website: Rs.' + d.website_price + ' | Saheehisab: Rs.' + d.saheehisab_price,
      url  : shareLink,
    });
  } catch(e) {}
}

function printReport() { window.print(); }

function copyToClipboard(text) {
  navigator.clipboard && navigator.clipboard.writeText(text).then(function() { showToast('Link copied!'); });
}

function showToast(msg) {
  var existing = document.getElementById('_toast');
  if (existing) existing.remove();
  var t = document.createElement('div');
  t.id = '_toast'; t.textContent = msg;
  Object.assign(t.style, { position:'fixed', bottom:'24px', left:'50%', transform:'translateX(-50%)', background:'var(--gold)', color:'var(--black)', padding:'10px 22px', borderRadius:'100px', fontSize:'13px', fontWeight:'600', zIndex:'9999' });
  document.body.appendChild(t);
  setTimeout(function() { t.remove(); }, 2500);
}

// Recalculate when user manually enters weight
async function recalculateWithWeight() {
  var weight = parseFloat(document.getElementById('manual-weight-input').value) || 0;
  if (!weight || weight <= 0) { showToast('Please enter a valid weight in grams'); return; }

  if (!state.lastResult) return;
  var data = state.lastResult.data;

  // Call server to recalculate with manual weight
  try {
    var res  = await fetch('/calculate-manual', {
      method : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body   : JSON.stringify({
        product_name  : data.product_name,
        metal         : data.metal || 'Gold',
        purity        : data.purity || '22K',
        jewellery_type: data.jewellery_key || 'plain',
        gold_weight   : weight,
        website_price : parseFloat(data.website_price) > 0 ? data.website_price : '0',
        stones        : (data.stone_breakdown || []).map(function(s) {
          return { stone_type: s.stone_type, weight: s.weight, weight_unit: s.weight_unit, website_stone_value: s.website_stone_value };
        }),
      }),
    });
    var json = await res.json();
    if (!json.success) throw new Error(json.error);

    // Merge recalculated data back — keep store price from original scrape
    var origStorePrice = data.website_price;
    var origGoldRate   = data.website_gold_rate;
    var merged = Object.assign({}, data, json.data, {
      gold_weight       : weight.toString(),
      website_price     : origStorePrice,
      website_gold_rate : origGoldRate,
      estimated_savings : origStorePrice && parseFloat(origStorePrice) > 0
        ? (parseFloat(origStorePrice) - parseFloat(json.data.saheehisab_price)).toFixed(2)
        : '0',
    });
    state.lastResult.data = merged;

    // Update chip
    setChip('chip-weight', weight + 'g Gold');
    document.getElementById('weight-input-box').classList.add('hidden');

    // Re-render comparison table and savings
    renderCompareTable(merged);
    renderSavings(merged);

    showToast('✓ Price calculated for ' + weight + 'g');
  } catch(err) {
    showToast('Error: ' + err.message);
  }
}

// ── Make This Product — sends full details to Saheehisab WhatsApp ────────────
function makeThisProduct() {
  if (!state.lastResult) return;
  var d   = state.lastResult.data;
  var url = '';
  var urlEl = document.getElementById('product-url');
  if (urlEl) url = urlEl.value.trim();

  var fmt = function(n) {
    return n && parseFloat(n) > 0
      ? 'Rs.' + parseFloat(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
      : 'Not available';
  };

  // Build stone text
  var stoneTxt = '';
  if (d.stone_breakdown && d.stone_breakdown.length) {
    var stoneLines = d.stone_breakdown
      .filter(function(s) { return parseFloat(s.weight) > 0; })
      .map(function(s) { return '%E2%80%A2 ' + s.stone_type + ': ' + s.weight + (s.weight_unit || 'ct'); });
    if (stoneLines.length) stoneTxt = '*Stone Details:*' + '%0A' + stoneLines.join('%0A') + '%0A%0A';
  }

  // Build full message — use %0A for newlines (WhatsApp safe)
  var lines = [
    '*%F0%9F%9B%95 Make This Jewellery %E2%80%94 Custom Order Request*',
    '',
    '*Product:* ' + (d.product_name || 'Jewellery'),
    '*Type:* '    + (d.jewellery_type || 'Jewellery'),
    '*Metal:* '   + (d.metal || 'Gold') + ' ' + (d.purity || ''),
    '*Weight:* '  + (parseFloat(d.gold_weight) > 0 ? d.gold_weight + 'g' : 'See product link'),
    '',
    '*Price Comparison:*',
    '%E2%80%A2 Store Price: '       + fmt(d.website_price),
    '%E2%80%A2 Saheehisab Price: '  + fmt(d.saheehisab_price),
    '%E2%80%A2 Making Charge: '     + (d.saheehisab_making_percent || '8') + '% (our rate)',
    (parseFloat(d.estimated_savings) > 0 ? '%E2%80%A2 You Save: ' + fmt(d.estimated_savings) : ''),
    '',
    (url ? '*Product Link:* ' + url : ''),
    (state.shareId ? '*Full Report:* ' + window.location.origin + '/share/' + state.shareId : ''),
    '',
    '_Please make this jewellery for me at Saheehisab price_',
  ].filter(function(l) { return l !== null && l !== undefined; });

  var msg = lines.join('%0A');
  window.open('https://wa.me/919509458270?text=' + msg, '_blank');
}

function resetApp() {
  document.getElementById('product-url').value = '';
  clearImage(); clearInvoice();
  document.getElementById('manual-form').classList.add('hidden');
  document.getElementById('stone-rows').innerHTML = '';
  hideResult(); hideError();
  state.lastResult = null; state.identifiedImage = null;
  window.scrollTo({ top:0, behavior:'smooth' });
}

// ── Helpers ────────────────────────────────────────────────────────────────────

var _loaderTimer = null;

function showLoader(text) {
  document.getElementById('loader-text').textContent = text || 'Processing…';
  document.getElementById('loader').classList.remove('hidden');
  document.getElementById('btn-analyse-url').disabled = true;

  // Rotating messages so customer knows it is working
  var messages = [
    text || 'Fetching product details…',
    'Reading product page…',
    'Extracting gold weight and price…',
    'Running AI analysis…',
    'Calculating Saheehisab price…',
    'Almost done…',
  ];
  var idx = 0;
  _loaderTimer = setInterval(function() {
    idx = (idx + 1) % messages.length;
    var el = document.getElementById('loader-text');
    if (el) el.textContent = messages[idx];
  }, 3000);
}

function hideLoader() {
  if (_loaderTimer) { clearInterval(_loaderTimer); _loaderTimer = null; }
  document.getElementById('loader').classList.add('hidden');
  document.getElementById('btn-analyse-url').disabled = false;
}

function showError(msg) {
  document.getElementById('error-msg').textContent = msg;
  document.getElementById('error-box').classList.remove('hidden');
}

function hideError() { document.getElementById('error-box').classList.add('hidden'); }
function hideResult() { document.getElementById('result').classList.add('hidden'); }

function isValidHttpUrl(str) {
  try { var u = new URL(str); return u.protocol === 'http:' || u.protocol === 'https:'; }
  catch(e) { return false; }
}

// ── Enquiry Form ───────────────────────────────────────────────────────────────

function toggleEnquiry() {
  var form = document.getElementById('enquiry-form');
  var btn  = document.getElementById('enquiry-toggle-btn');
  var open = form.classList.toggle('hidden');
  btn.textContent = open ? '+ Open Form' : '− Close Form';
}

async function submitEnquiry() {
  var name  = (document.getElementById('eq-name').value || '').trim();
  var phone = (document.getElementById('eq-phone').value || '').trim();
  var email = (document.getElementById('eq-email').value || '').trim();
  var msg   = (document.getElementById('eq-message').value || '').trim();

  if (!name)  { showToast('Please enter your name.'); return; }
  if (!phone) { showToast('Please enter your phone number.'); return; }

  var d = state.lastResult ? state.lastResult.data : {};
  var btn = document.getElementById('btn-eq-submit');
  btn.disabled    = true;
  btn.textContent = 'Sending…';

  try {
    var res  = await fetch('/enquiry', {
      method : 'POST',
      headers: { 'Content-Type':'application/json' },
      body   : JSON.stringify({
        name             : name,
        phone            : phone,
        email            : email,
        message          : msg,
        source_url       : document.getElementById('product-url') ? document.getElementById('product-url').value : '',
        product_name     : d.product_name     || '',
        website_price    : d.website_price    || '',
        saheehisab_price : d.saheehisab_price || '',
        estimated_savings: d.estimated_savings|| '',
      }),
    });
    var json = await res.json();
    if (!json.success) throw new Error(json.error || 'Failed');

    // Success UI
    document.getElementById('enquiry-form').innerHTML =
      '<div style="text-align:center;padding:24px">' +
      '<div style="font-size:36px;margin-bottom:12px">✅</div>' +
      '<p style="font-size:16px;font-weight:600;color:var(--white);margin-bottom:6px">Enquiry Sent!</p>' +
      '<p style="font-size:13px;color:var(--white-dim)">Thank you, ' + name + '. We will contact you shortly on ' + phone + '.</p>' +
      '</div>';
    document.getElementById('enquiry-toggle-btn').style.display = 'none';
  } catch(err) {
    showToast('Failed: ' + err.message);
    btn.disabled    = false;
    btn.textContent = 'Send Enquiry →';
  }
}