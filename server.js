'use strict';

require('dotenv').config();

const express      = require('express');
const helmet       = require('helmet');
const cors         = require('cors');
const rateLimit    = require('express-rate-limit');
const multer       = require('multer');
const path         = require('path');
const fs           = require('fs');
const { chromium } = require('playwright');
const OpenAI       = require('openai');
const sharp        = require('sharp');

const app  = express();
const PORT = process.env.PORT || 5050;

// ── Rates file ────────────────────────────────────────────────────────────────

const RATES_FILE = path.join(__dirname, 'rates.json');

function loadRates() {
  try { if (fs.existsSync(RATES_FILE)) return JSON.parse(fs.readFileSync(RATES_FILE, 'utf8')); }
  catch (e) {}
  return {};
}

function saveRates(rates) { fs.writeFileSync(RATES_FILE, JSON.stringify(rates, null, 2)); }

function getRates() {
  var s = loadRates();
  return {
    gold_24k        : s.gold_24k        || parseFloat(process.env.GOLD_RATE_24K)  || 9850,
    gold_22k        : s.gold_22k        || parseFloat(process.env.GOLD_RATE_22K)  || 9150,
    gold_18k        : s.gold_18k        || parseFloat(process.env.GOLD_RATE_18K)  || 7390,
    gold_14k        : s.gold_14k        || 5700,
    silver          : s.silver          || parseFloat(process.env.SILVER_RATE)    || 110,
    platinum        : s.platinum        || parseFloat(process.env.PLATINUM_RATE)  || 3200,
    diamond         : s.diamond         || parseFloat(process.env.DIAMOND_RATE)   || 55000,
    polki           : s.polki           || 8000,
    ruby            : s.ruby            || 12000,
    emerald         : s.emerald         || 10000,
    sapphire        : s.sapphire        || 9000,
    pearl           : s.pearl           || 3000,
    coral           : s.coral           || 2000,
    turquoise       : s.turquoise       || 1500,
    opal            : s.opal            || 4000,
    amethyst        : s.amethyst        || 800,
    topaz           : s.topaz           || 1200,
    garnet          : s.garnet          || 600,
    spinel          : s.spinel          || 5000,
    other_stone     : s.other_stone     || parseFloat(process.env.STONE_RATE) || 500,
    making_chain    : s.making_chain    || 5,
    making_ring     : s.making_ring     || 8,
    making_necklace : s.making_necklace || 10,
    making_pendant  : s.making_pendant  || 8,
    making_bangle   : s.making_bangle   || 7,
    making_earrings : s.making_earrings || 8,
    making_jhumka   : s.making_jhumka   || 10,
    making_temple   : s.making_temple   || 12,
    making_kundan   : s.making_kundan   || 14,
    making_bracelet : s.making_bracelet || 8,
    making_anklet   : s.making_anklet   || 7,
    making_plain    : s.making_plain    || 8,
  };
}


// ── Leads Database (JSON file) ────────────────────────────────────────────────

var LEADS_FILE = path.join(__dirname, 'leads.json');

function loadLeads() {
  try { if (fs.existsSync(LEADS_FILE)) return JSON.parse(fs.readFileSync(LEADS_FILE, 'utf8')); }
  catch(e) {}
  return [];
}

function saveLead(lead) {
  var leads = loadLeads();
  lead.id        = Date.now() + '-' + Math.random().toString(36).slice(2, 7);
  lead.timestamp = new Date().toISOString();
  leads.unshift(lead); // newest first
  try { fs.writeFileSync(LEADS_FILE, JSON.stringify(leads, null, 2)); }
  catch(e) { console.error('[leads] Save failed:', e.message); }
  return lead;
}

function getClientInfo(req) {
  var ip         = req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown';
  var userAgent  = req.headers['user-agent'] || 'unknown';
  var referer    = req.headers['referer'] || '';
  var language   = req.headers['accept-language'] || '';
  // Parse device type from UA
  var isMobile   = /Mobile|Android|iPhone|iPad/i.test(userAgent);
  var browser    = 'Unknown';
  if (userAgent.indexOf('Chrome') !== -1)  browser = 'Chrome';
  else if (userAgent.indexOf('Safari') !== -1)  browser = 'Safari';
  else if (userAgent.indexOf('Firefox') !== -1) browser = 'Firefox';
  else if (userAgent.indexOf('Edge') !== -1)    browser = 'Edge';
  return {
    ip       : ip.split(',')[0].trim(),
    device   : isMobile ? 'Mobile' : 'Desktop',
    browser  : browser,
    language : language.split(',')[0],
    referer  : referer,
  };
}

// ── Uploads dir ───────────────────────────────────────────────────────────────

const UPLOADS_DIR     = path.join(__dirname, 'uploads');
const SAVED_IMGS_DIR  = path.join(__dirname, 'public', 'saved-images');
if (!fs.existsSync(UPLOADS_DIR))    fs.mkdirSync(UPLOADS_DIR,    { recursive: true });
if (!fs.existsSync(SAVED_IMGS_DIR)) fs.mkdirSync(SAVED_IMGS_DIR, { recursive: true });

var SHARES_FILE = path.join(__dirname, 'shares.json');
function loadShares() { try { return fs.existsSync(SHARES_FILE) ? JSON.parse(fs.readFileSync(SHARES_FILE,'utf8')) : {}; } catch(e) { return {}; } }
function saveShare(id, data) { var s = loadShares(); s[id] = data; fs.writeFileSync(SHARES_FILE, JSON.stringify(s, null, 2)); }
function getShare(id) { return loadShares()[id] || null; }

function saveImageFile(buffer, ext) {
  var filename = Date.now() + '-' + Math.random().toString(36).slice(2,7) + (ext || '.jpg');
  var filepath = path.join(SAVED_IMGS_DIR, filename);
  fs.writeFileSync(filepath, buffer);
  return '/saved-images/' + filename;
}

async function downloadImage(url) {
  try {
    var https = require('https');
    var http  = require('http');
    var mod   = url.startsWith('https') ? https : http;
    return await new Promise(function(resolve, reject) {
      mod.get(url, { timeout: 8000 }, function(res) {
        var chunks = [];
        res.on('data', function(c) { chunks.push(c); });
        res.on('end',  function()  { resolve(Buffer.concat(chunks)); });
        res.on('error', reject);
      }).on('error', reject);
    });
  } catch(e) { return null; }
}

// ── OpenAI ────────────────────────────────────────────────────────────────────

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// ── Middleware ────────────────────────────────────────────────────────────────

// ── Security ─────────────────────────────────────────────────────────────────
app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.disable('x-powered-by');

// Rate limiter
const analysisLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 30, message: { success: false, error: 'Rate limit exceeded.' } });

// ── Multer ────────────────────────────────────────────────────────────────────

const upload = multer({
  storage: multer.diskStorage({
    destination: function(req, file, cb) { cb(null, UPLOADS_DIR); },
    filename   : function(req, file, cb) { cb(null, Date.now() + '-' + Math.round(Math.random() * 1e9) + path.extname(file.originalname)); },
  }),
  limits    : { fileSize: 10 * 1024 * 1024 },
  fileFilter: function(req, file, cb) {
    if (['image/jpeg','image/png','image/webp','image/gif'].includes(file.mimetype)) return cb(null, true);
    cb(new Error('Only JPEG, PNG, WEBP, GIF allowed.'));
  },
});

// ── Static ────────────────────────────────────────────────────────────────────

// ── Auth: client-side only — server serves all pages freely ─────────────────

// Parse cookies
app.use(function(req, res, next) {
  var cookieStr = req.headers.cookie || '';
  req.cookies  = {};
  cookieStr.split(';').forEach(function(c) {
    var parts = c.trim().split('=');
    if (parts[0]) req.cookies[parts[0].trim()] = (parts[1] || '').trim();
  });
  next();
});

app.use(express.static(path.join(__dirname, 'public')));

// ── Helpers ───────────────────────────────────────────────────────────────────

// Input validation helpers
function sanitizeString(s, maxLen) {
  if (typeof s !== 'string') return '';
  return s.replace(/[<>"'`;]/g, '').trim().slice(0, maxLen || 500);
}

function validatePhone(phone) {
  if (!phone) return false;
  var clean = phone.replace(/[^0-9+]/g,'');
  return clean.length >= 10 && clean.length <= 15;
}

function validateEmail(email) {
  if (!email) return true; // optional
  return /^[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}$/.test(email) && email.length < 200;
}

function isValidUrl(str) {
  try { var u = new URL(str); return u.protocol === 'http:' || u.protocol === 'https:'; }
  catch (e) { return false; }
}

function safeFloat(val) {
  var n = parseFloat(String(val || '').replace(/[^\d.]/g, ''));
  return isNaN(n) ? 0 : n;
}

function detectJewelleryType(text) {
  var t = (text || '').toLowerCase();
  if (t.indexOf('temple')  !== -1)                                   return 'temple';
  if (t.indexOf('kundan')  !== -1)                                   return 'kundan';
  if (t.indexOf('chain')   !== -1)                                   return 'chain';
  if (t.indexOf('ring')    !== -1)                                   return 'ring';
  if (t.indexOf('necklace')!== -1)                                   return 'necklace';
  if (t.indexOf('pendant') !== -1)                                   return 'pendant';
  if (t.indexOf('bangle')  !== -1)                                   return 'bangle';
  if (t.indexOf('earring') !== -1)                                   return 'earrings';
  if (t.indexOf('jhumka')  !== -1 || t.indexOf('jhumki') !== -1)    return 'jhumka';
  if (t.indexOf('bracelet')!== -1)                                   return 'bracelet';
  if (t.indexOf('anklet')  !== -1)                                   return 'anklet';
  return 'plain';
}

var JEWELLERY_LABELS = {
  temple: 'Temple Jewellery', kundan: 'Kundan', chain: 'Chain',
  ring: 'Ring', necklace: 'Necklace', pendant: 'Pendant',
  bangle: 'Bangle', earrings: 'Earrings', jhumka: 'Jhumka',
  bracelet: 'Bracelet', anklet: 'Anklet', plain: 'Plain Jewellery',
};

function getMakingPercent(key, rates) { return rates['making_' + key] || rates.making_plain || 8; }

function getGoldRate(purity, rates) {
  var p = (purity || '').toLowerCase().replace(/[\s\-]/g, '');
  if (p.indexOf('24') !== -1 || p === '999') return rates.gold_24k;
  if (p.indexOf('22') !== -1 || p === '916') return rates.gold_22k;
  if (p.indexOf('18') !== -1 || p === '750') return rates.gold_18k;
  if (p.indexOf('14') !== -1 || p === '585') return rates.gold_14k;
  if (p.indexOf('silver') !== -1)  return rates.silver;
  if (p.indexOf('platinum') !== -1)return rates.platinum;
  return rates.gold_22k; // default to 22K
}

function getStoneRate(stoneName, rates) {
  if (!stoneName) return rates.other_stone;
  var s = stoneName.toLowerCase();
  if (s.indexOf('diamond')   !== -1) return rates.diamond;
  if (s.indexOf('polki')     !== -1) return rates.polki;
  if (s.indexOf('ruby')      !== -1) return rates.ruby;
  if (s.indexOf('emerald')   !== -1) return rates.emerald;
  if (s.indexOf('sapphire')  !== -1) return rates.sapphire;
  if (s.indexOf('pearl')     !== -1) return rates.pearl;
  if (s.indexOf('coral')     !== -1) return rates.coral;
  if (s.indexOf('turquoise') !== -1) return rates.turquoise;
  if (s.indexOf('opal')      !== -1) return rates.opal;
  if (s.indexOf('amethyst')  !== -1) return rates.amethyst;
  if (s.indexOf('topaz')     !== -1) return rates.topaz;
  if (s.indexOf('garnet')    !== -1) return rates.garnet;
  if (s.indexOf('spinel')    !== -1) return rates.spinel;
  return rates.other_stone;
}

// ── Pricing Engine ────────────────────────────────────────────────────────────

function calculateSaheehisabPrice(ai, rates) {
  var jewelleryKey  = detectJewelleryType((ai.product_name || '') + ' ' + (ai.jewellery_type || ''));
  var makingPercent = getMakingPercent(jewelleryKey, rates);
  var goldRate      = getGoldRate(ai.purity, rates);
  var goldWeight    = safeFloat(ai.gold_weight);

  // ── SMART WEIGHT DERIVATION ───────────────────────────────────────────────
  // If weight is missing, calculate from available data
  var _wsGoldRate = safeFloat(ai.gold_rate_per_gram);
  var _wsGoldVal  = safeFloat(ai.website_gold_value);
  var _wsTotal    = safeFloat(ai.website_total);
  var _wsMaking   = safeFloat(ai.website_making_charge);
  var _wsGst      = safeFloat(ai.website_gst);
  var _wsStone    = safeFloat(ai.website_stone_value);

  if (goldWeight === 0) {
    if (_wsGoldVal > 0 && _wsGoldRate > 0) {
      // Method 1: weight = gold_value ÷ site_gold_rate (most accurate)
      goldWeight = _wsGoldVal / _wsGoldRate;
      console.log('[pricing] Weight derived: goldValue/siteRate =', goldWeight.toFixed(3) + 'g');
    } else if (_wsGoldVal > 0 && goldRate > 0) {
      // Method 2: weight = gold_value ÷ our_rate
      goldWeight = _wsGoldVal / goldRate;
      console.log('[pricing] Weight derived: goldValue/ourRate =', goldWeight.toFixed(3) + 'g');
    } else if (_wsTotal > 0 && _wsGoldRate > 0) {
      // Method 3: weight = (total - stones - making - gst) ÷ site_rate
      var _estimatedGoldVal = _wsTotal - _wsStone - _wsMaking - _wsGst;
      if (_estimatedGoldVal > 100) {
        goldWeight = _estimatedGoldVal / _wsGoldRate;
        console.log('[pricing] Weight derived: (total-deductions)/siteRate =', goldWeight.toFixed(3) + 'g');
      }
    } else if (_wsTotal > 0 && goldRate > 0 && _wsTotal > 1000 && (_wsMaking > 0 || _wsGst > 0)) {
      // Method 4: only estimate from total if we also have making/gst to subtract
      // Without these, the estimate is too inaccurate and makes our price > store price
      var _estimatedGoldVal2 = _wsTotal - _wsStone - _wsMaking - _wsGst;
      if (_estimatedGoldVal2 > 100 && _estimatedGoldVal2 < _wsTotal * 0.95) {
        goldWeight = _estimatedGoldVal2 / goldRate;
        console.log('[pricing] Weight estimated (with deductions):', goldWeight.toFixed(3) + 'g');
      }
    }
  }
  // ─────────────────────────────────────────────────────────────────────────


  var stones = Array.isArray(ai.stones) ? ai.stones : (ai.stones ? [ai.stones] : []);
  if (stones.length === 0) {
    if (safeFloat(ai.diamond_weight) > 0) stones.push({ stone_type: 'Diamond', weight: ai.diamond_weight, weight_unit: 'carat' });
    if (safeFloat(ai.stone_weight)   > 0) stones.push({ stone_type: 'Other Stone', weight: ai.stone_weight, weight_unit: 'gram' });
  }

  var stoneBreakdown = stones.map(function(s) {
    var weight    = safeFloat(s.weight);
    var ourRate   = getStoneRate(s.stone_type, rates);
    var ourValue  = weight * ourRate;
    // Website rate and value — extract and calculate both ways
    var siteRate  = safeFloat(s.website_rate_per_unit);
    var siteValue = safeFloat(s.website_stone_value);
    // Calculate missing values from what we have
    if (siteValue === 0 && siteRate > 0 && weight > 0) {
      siteValue = siteRate * weight;
    }
    if (siteRate === 0 && siteValue > 0 && weight > 0) {
      siteRate = siteValue / weight; // derive rate from value and weight
    }
    return {
      stone_type           : s.stone_type || 'Stone',
      weight               : weight,
      weight_unit          : s.weight_unit || 'carat',
      rate                 : ourRate,
      value                : ourValue,
      website_rate_per_unit: siteRate,
      website_stone_value  : siteValue,
    };
  });

  var totalStoneValue = stoneBreakdown.reduce(function(sum, s) { return sum + s.value; }, 0);
  var goldValue       = goldWeight * goldRate;
  var makingCharge    = goldValue * (makingPercent / 100);
  var gst             = (goldValue + makingCharge) * 0.03;
  var totalPrice      = goldValue + totalStoneValue + makingCharge + gst;
  var websiteTotal    = safeFloat(ai.website_total);
  var websiteGoldVal  = safeFloat(ai.website_gold_value);
  var websiteMaking   = safeFloat(ai.website_making_charge);
  // Sum all website stone values from AI extraction
  var websiteStoneVal = 0;
  if (Array.isArray(ai.stones)) {
    ai.stones.forEach(function(s) { websiteStoneVal += safeFloat(s.website_stone_value); });
  }
  // If AI didn't extract individual stone values, try top-level field
  if (websiteStoneVal === 0) { websiteStoneVal = safeFloat(ai.website_stone_value); }

  // ── SMART GOLD RATE CALCULATION ──────────────────────────────────────────────
  // If website gold rate is missing but gold value + weight are known → derive it
  var websiteGoldRate = safeFloat(ai.gold_rate_per_gram);
  if (websiteGoldRate === 0 && websiteGoldVal > 0 && goldWeight > 0) {
    websiteGoldRate = websiteGoldVal / goldWeight;
    console.log('[pricing] Gold rate derived from value/weight:', websiteGoldRate.toFixed(2));
  }
  // If gold value is missing but rate + weight are known → derive value
  if (websiteGoldVal === 0 && websiteGoldRate > 0 && goldWeight > 0) {
    websiteGoldVal = websiteGoldRate * goldWeight;
    console.log('[pricing] Gold value derived from rate×weight:', websiteGoldVal.toFixed(2));
  }
  // Site gold rate/value not available — show only total, no back-calc to avoid wrong rates









  // Making % = making charge as % of gold value
  var websiteMakingPct = websiteGoldVal > 0 ? ((websiteMaking / websiteGoldVal) * 100).toFixed(2) : '0';
  // If making charge is missing but we have total, gold value and stone value → derive it
  if (websiteMaking === 0 && websiteTotal > 0 && websiteGoldVal > 0) {
    var gstAmt = safeFloat(ai.website_gst);
    var derivedMaking = websiteTotal - websiteGoldVal - websiteStoneVal - gstAmt;
    if (derivedMaking > 0) {
      websiteMaking    = derivedMaking;
      websiteMakingPct = ((websiteMaking / websiteGoldVal) * 100).toFixed(2);
      console.log('[pricing] Making charge derived:', websiteMaking.toFixed(2), '(' + websiteMakingPct + '%)');
    }
  }

  return {
    jewellery_key             : jewelleryKey,
    jewellery_label           : JEWELLERY_LABELS[jewelleryKey] || 'Jewellery',
    making_percent            : makingPercent,
    gold_rate_used            : goldRate,
    stone_breakdown           : stoneBreakdown,
    total_stone_value         : totalStoneValue.toFixed(2),
    website_gold_rate         : websiteGoldRate.toFixed(2),
    website_gold_value        : websiteGoldVal.toFixed(2),
    website_stone_value       : websiteStoneVal.toFixed(2),
    website_making_percent    : websiteMakingPct,
    website_making_charge     : websiteMaking.toFixed(2),
    website_gst               : safeFloat(ai.website_gst).toFixed(2),
    website_price             : websiteTotal.toFixed(2),
    saheehisab_gold_rate      : goldRate.toFixed(2),
    saheehisab_gold_value     : goldValue.toFixed(2),
    saheehisab_making_percent : makingPercent.toFixed(2),
    saheehisab_making_charge  : makingCharge.toFixed(2),
    saheehisab_gst            : gst.toFixed(2),
    saheehisab_stone_value    : totalStoneValue.toFixed(2),
    saheehisab_price          : totalPrice.toFixed(2),
    estimated_savings         : (websiteTotal - totalPrice).toFixed(2),
  };
}

// ── Persistent Browser Pool (reuse across requests = much faster) ─────────────

var _browserInstance = null;

async function getBrowser() {
  // Reuse existing browser if it's still alive
  if (_browserInstance) {
    try {
      // Quick health check — if it throws, browser is dead
      await _browserInstance.version();
      return _browserInstance;
    } catch (e) {
      _browserInstance = null;
    }
  }
  console.log('[browser] Launching new browser instance...');
  _browserInstance = await chromium.launch({
    headless: true,
    args: [
      '--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage',
      '--ignore-certificate-errors', '--ignore-ssl-errors',
      '--disable-blink-features=AutomationControlled',
      '--disable-web-security', '--no-first-run', '--disable-infobars',
    ],
  });
  // Auto-cleanup if browser crashes
  _browserInstance.on('disconnected', function() { _browserInstance = null; });
  return _browserInstance;
}

// ── Scraper ───────────────────────────────────────────────────────────────────

var CONTEXT_OPTS = {
  userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  viewport : { width: 1280, height: 800 },
  locale   : 'en-IN',
  timezoneId: 'Asia/Kolkata',
  ignoreHTTPSErrors: true,
  extraHTTPHeaders: {
    'Accept-Language'          : 'en-IN,en-GB;q=0.9,en;q=0.8',
    'Accept'                   : 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
    'Cache-Control'            : 'no-cache',
    'Sec-Ch-Ua'                : '"Chromium";v="124", "Google Chrome";v="124"',
    'Sec-Ch-Ua-Mobile'         : '?0',
    'Sec-Ch-Ua-Platform'       : '"macOS"',
    'Sec-Fetch-Dest'           : 'document',
    'Sec-Fetch-Mode'           : 'navigate',
    'Sec-Fetch-Site'           : 'none',
    'Upgrade-Insecure-Requests': '1',
  },
};

async function scrapePage(url, browser) {
  var context = await browser.newContext(CONTEXT_OPTS);
  var page    = await context.newPage();

  // For CaratLane — set India store cookie to prevent US redirect
  if (url.indexOf('caratlane.com') !== -1) {
    await context.addCookies([
      { name: 'store', value: 'default', domain: '.caratlane.com', path: '/' },
      { name: 'X-Magento-Vary', value: 'default', domain: '.caratlane.com', path: '/' },
      { name: 'mage-cache-sessid', value: 'true', domain: '.caratlane.com', path: '/' },
    ]);
  }

  await page.addInitScript(function() {
    Object.defineProperty(navigator, 'webdriver', { get: function() { return undefined; } });
    Object.defineProperty(navigator, 'plugins',   { get: function() { return [1,2,3,4,5]; } });
    Object.defineProperty(navigator, 'languages', { get: function() { return ['en-IN','en-GB','en']; } });
    window.chrome = { runtime: {} };
  });

  // Block only truly heavy resources — keep stylesheets for JS-rendered pricing tables
  await page.route('**/*', function(route) {
    var type = route.request().resourceType();
    if (type === 'media' || type === 'websocket' || type === 'eventsource') {
      return route.abort();
    }
    // Block tracking/analytics scripts to speed up
    var reqUrl = route.request().url();
    if (reqUrl.indexOf('google-analytics') !== -1 || reqUrl.indexOf('googletagmanager') !== -1 ||
        reqUrl.indexOf('facebook.net') !== -1 || reqUrl.indexOf('hotjar') !== -1) {
      return route.abort();
    }
    return route.continue();
  });

  // domcontentloaded first, then wait for pricing table JS to render
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 });
  } catch (e1) {
    throw new Error('Page failed to load: ' + e1.message);
  }

  // Wait for JS pricing content to render (pricing tables are often JS-rendered)
  await page.waitForTimeout(2000);

  // Scroll down to trigger lazy-loaded pricing tabs/sections
  await page.evaluate(function() {
    window.scrollBy(0, 600);
  });
  await page.waitForTimeout(800);
  await page.evaluate(function() {
    // Click any pricing/specification tabs that might be present
    var tabs = Array.from(document.querySelectorAll('a, button, [role="tab"]'));
    var pricingTab = tabs.find(function(el) {
      var txt = (el.innerText || el.textContent || '').toLowerCase();
      return txt.indexOf('pric') !== -1 || txt.indexOf('product pricing') !== -1 || txt.indexOf('specification') !== -1;
    });
    if (pricingTab) { try { pricingTab.click(); } catch(e) {} }
  });
  await page.waitForTimeout(800);

  var product = await page.evaluate(function() {
    var h1      = document.querySelector('h1');
    var title   = (h1 ? h1.innerText.trim() : document.title) || '';
    var metaD   = document.querySelector('meta[name="description"]') || document.querySelector('meta[property="og:description"]');
    var desc    = metaD ? (metaD.getAttribute('content') || '') : '';
    var ogImg   = document.querySelector('meta[property="og:image"]');
    var image   = ogImg ? (ogImg.getAttribute('content') || '') : '';

    // Try to find and extract pricing table specifically
    var pricingText = '';
    var allTables = Array.from(document.querySelectorAll('table'));
    allTables.forEach(function(tbl) {
      var txt = tbl.innerText || '';
      if (txt.toLowerCase().indexOf('gold') !== -1 || txt.toLowerCase().indexOf('diamond') !== -1 ||
          txt.toLowerCase().indexOf('making') !== -1 || txt.toLowerCase().indexOf('rate') !== -1) {
        pricingText += '\n[PRICING TABLE]\n' + txt + '\n';
      }
    });

    // Also grab any div/section that looks like a pricing breakdown
    var pricingDivs = Array.from(document.querySelectorAll('[class*="pric"], [class*="price"], [class*="cost"], [id*="pric"], [id*="price"]'));
    pricingDivs.forEach(function(el) {
      var txt = el.innerText || '';
      if (txt.length > 20 && txt.length < 3000) {
        pricingText += '\n[PRICING SECTION]\n' + txt + '\n';
      }
    });

    var text = (document.body ? document.body.innerText : '').slice(0, 15000);
    var jldEls = Array.from(document.querySelectorAll('script[type="application/ld+json"]'));
    var jld    = jldEls.map(function(s) { return s.textContent; }).join('\n').slice(0, 3000);

    // CaratLane / Next.js sites embed full product data in __NEXT_DATA__
    var nextData = '';
    try {
      var nextScript = document.getElementById('__NEXT_DATA__');
      if (nextScript) {
        var nd = JSON.parse(nextScript.textContent);
        // Walk the props tree to find product data
        var str = JSON.stringify(nd).slice(0, 15000);
        // Extract key fields
        var ndWeight = str.match(/"(?:netWeight|goldWeight|net_weight|gold_weight|netGoldWeight)"\s*:\s*"?([\d.]+)"?/g) || [];
        var ndPrice  = str.match(/"(?:price|totalPrice|grandTotal)"\s*:\s*"?([\d.]+)"?/g) || [];
        var ndPurity = str.match(/"(?:purity|metalPurity|metalType)"\s*:\s*"([^"]+)"/g) || [];
        nextData = '[NEXT_DATA] ' + ndWeight.join(' ') + ' ' + ndPrice.join(' ') + ' ' + ndPurity.join(' ');
        // Also include raw relevant portions
        var goldIdx = str.indexOf('goldWeight');
        if (goldIdx === -1) goldIdx = str.indexOf('netWeight');
        if (goldIdx !== -1) nextData += ' [RAW] ' + str.slice(Math.max(0, goldIdx-50), goldIdx+200);
      }
    } catch(e) {}

    // CaratLane specific extraction
    var clExtra = '';
    try {
      // Weight in specifications
      var specEls = Array.from(document.querySelectorAll('[class*="spec"], [class*="Spec"], [class*="detail"], [class*="Detail"], [class*="product-info"], dl, .pdp'));
      specEls.forEach(function(el) {
        var t = el.innerText || '';
        if (/weight|purity|metal|diamond|karat/i.test(t) && t.length < 2000) {
          clExtra += '[SPEC] ' + t + ' ';
        }
      });
      // Find weight patterns in all text
      var bodyText = document.body.innerText;
      var wts = bodyText.match(/(?:net|gold|gross)\s*weight[^\n]{0,40}/gi) || [];
      if (wts.length) clExtra += '[WEIGHTS] ' + wts.join(' | ') + ' ';
      var numWts = bodyText.match(/\d+\.?\d*\s*(?:g|gm|gms|gram)s?(?:\s|,|\n)/gi) || [];
      if (numWts.length) clExtra += '[GRAM VALUES] ' + numWts.slice(0,10).join(' ') + ' ';
    } catch(e) {}

    // Pricing content goes first so AI sees it prominently
    var fullText = nextData + ' ' + clExtra + pricingText.slice(0, 5000) + '\n\n[PAGE TEXT]\n' + text + '\n\n[STRUCTURED DATA]\n' + jld;

    return { title: title, description: desc, image: image, text: fullText };
  });

  // Site-specific extraction boost
  if (!product.text || product.text.length < 500) {
    try {
      // Try clicking spec/detail tabs that may contain weight info
      await page.evaluate(function() {
        var tabs = Array.from(document.querySelectorAll('button, a, [role="tab"], li'));
        var specTab = tabs.find(function(t) {
          var txt = (t.textContent || '').toLowerCase();
          return txt.includes('spec') || txt.includes('detail') || txt.includes('product info') || txt.includes('description');
        });
        if (specTab) try { specTab.click(); } catch(e) {}
      });
      await page.waitForTimeout(1000);
      // Re-extract text after clicking
      var refreshed = await page.evaluate(function() {
        return (document.body ? document.body.innerText : '').slice(0, 20000);
      });
      if (refreshed.length > product.text.length) product.text = refreshed;
    } catch(e) {}
  }

  await context.close();
  return product;
}


// ── CaratLane live gold rate fetcher ─────────────────────────────────────────
var _caratlaneRateCache = { rate: 0, ts: 0 };

async function fetchCaratLaneRate() {
  // Cache for 5 minutes
  if (_caratlaneRateCache.rate > 0 && Date.now() - _caratlaneRateCache.ts < 300000) {
    return _caratlaneRateCache.rate;
  }
  try {
    var https = require('https');
    // Try their gold rate API
    var rateUrl = 'https://www.caratlane.com/rest/V1/goldrate';
    var data = await new Promise(function(resolve) {
      var req = https.get(rateUrl, {
        headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'application/json', 'Referer': 'https://www.caratlane.com' },
        timeout: 8000,
      }, function(res) {
        var chunks = [];
        res.on('data', function(c) { chunks.push(c); });
        res.on('end', function() {
          try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
          catch(e) { resolve(null); }
        });
      });
      req.on('error', function() { resolve(null); });
      req.on('timeout', function() { req.destroy(); resolve(null); });
    });

    if (data) {
      // Try different response formats
      var rate = 0;
      if (Array.isArray(data)) {
        var r22 = data.find(function(r) { return String(r.karat||r.purity||'').indexOf('22') !== -1; });
        if (r22) rate = parseFloat(r22.rate || r22.price || r22.value || 0);
      } else if (data.rate22k || data['22k'] || data.gold22k) {
        rate = parseFloat(data.rate22k || data['22k'] || data.gold22k);
      }
      if (rate > 5000) {
        _caratlaneRateCache = { rate: rate, ts: Date.now() };
        console.log('[caratlane-rate] Fetched live rate:', rate);
        return rate;
      }
    }
  } catch(e) {
    console.log('[caratlane-rate] API failed:', e.message);
  }
  return 0;
}

// ── CaratLane direct API extractor ───────────────────────────────────────────

async function extractCaratLane(url) {
  try {
    var nodehttps = require('https');

    // Extract SKU from URL — e.g. radiant-hexa-diamond-mangalsutra-js01799-1yp900.html
    // SKU is the last part after final hyphen groups: js01799-1yp900
    var urlPath  = url.split('?')[0].replace(/\.html?$/, '').toLowerCase();
    var slug     = urlPath.split('/').pop();
    var parts    = slug.split('-');

    // SKU pattern: two segments where first starts with letters+numbers (like js01799)
    // Walk from end to find the SKU
    var sku = '';
    for (var i = parts.length - 1; i >= 1; i--) {
      if (/^[0-9][a-z0-9]+$/i.test(parts[i]) && /^[a-z]{1,3}[0-9]+$/i.test(parts[i-1])) {
        sku = parts[i-1] + '-' + parts[i];
        break;
      }
    }
    if (!sku) sku = parts.slice(-2).join('-');
    sku = sku.toUpperCase();
    console.log('[caratlane] URL:', url);
    console.log('[caratlane] Trying SKU:', sku);

    // CaratLane product detail API — used by their mobile app
    // CaratLane API endpoints to try
    var apiUrls = [
      'https://www.caratlane.com/rest/default/V1/products/' + sku,
      'https://www.caratlane.com/rest/V1/products/' + sku,
      'https://www.caratlane.com/index.php/rest/V1/products/' + sku,
    ];
    var apiUrl = apiUrls[0];

    var data = await new Promise(function(resolve, reject) {
      var req = nodehttps.get(apiUrl, {
        headers: {
          'User-Agent'      : 'CaratLane/6.0 (iPhone; iOS 17.0)',
          'Accept'          : 'application/json',
          'Accept-Language' : 'en-IN',
          'Referer'         : 'https://www.caratlane.com/',
          'x-requested-with': 'XMLHttpRequest',
          'Origin'          : 'https://www.caratlane.com',
        },
        timeout: 15000,
      }, function(res) {
        var chunks = [];
        res.on('data', function(c) { chunks.push(c); });
        res.on('end', function() {
          var body = Buffer.concat(chunks).toString('utf8');
          console.log('[caratlane] API status:', res.statusCode, 'body length:', body.length);
          if (res.statusCode === 200) {
            try { resolve(JSON.parse(body)); } catch(e) { resolve(null); }
          } else {
            console.log('[caratlane] API response:', body.slice(0, 200));
            resolve(null);
          }
        });
        res.on('error', reject);
      });
      req.on('error', function(e) { console.log('[caratlane] API error:', e.message); resolve(null); });
      req.on('timeout', function() { req.destroy(); resolve(null); });
    });

    // Try alternate API if first fails
    if (!data || data.message) {
      var altUrl = 'https://www.caratlane.com/rest/V2/products/' + sku + '?fields=name,sku,price,custom_attributes,extension_attributes';
      data = await new Promise(function(resolve) {
        nodehttps.get(altUrl, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15',
            'Accept': 'application/json',
            'Referer': 'https://www.caratlane.com/',
          },
          timeout: 10000,
        }, function(res) {
          var chunks = [];
          res.on('data', function(c) { chunks.push(c); });
          res.on('end', function() {
            var body = Buffer.concat(chunks).toString('utf8');
            console.log('[caratlane] V2 API status:', res.statusCode);
            if (res.statusCode === 200) {
              try { resolve(JSON.parse(body)); } catch(e) { resolve(null); }
            } else { resolve(null); }
          });
        }).on('error', function() { resolve(null); });
      });
    }

    if (!data || data.message || !data.name) {
      console.log('[caratlane] No valid API data, data:', data ? JSON.stringify(data).slice(0,100) : 'null');
      return null;
    }

    console.log('[caratlane] Got product:', data.name);

    // Parse custom_attributes into map
    var attrs = {};
    if (Array.isArray(data.custom_attributes)) {
      data.custom_attributes.forEach(function(a) { attrs[a.attribute_code] = a.value; });
    }

    // Try extension_attributes too
    var ext = data.extension_attributes || {};

    var goldWeight   = attrs.cl_gold_weight    || attrs.gold_weight    || attrs.net_weight     || ext.cl_gold_weight    || '';
    var diamondWt    = attrs.cl_diamond_weight || attrs.diamond_weight || ext.cl_diamond_weight || '';
    var purity       = attrs.cl_metal_purity   || attrs.metal_purity   || ext.cl_metal_purity   || '';
    var goldRate     = attrs.cl_gold_rate       || attrs.gold_rate      || ext.cl_gold_rate       || '';
    var diamondRate  = attrs.cl_diamond_rate    || ext.cl_diamond_rate  || '';
    var makingCharge = attrs.cl_making_charge   || attrs.making_charge  || ext.cl_making_charge  || '';
    var gstAmount    = attrs.cl_gst_amount      || ext.cl_gst_amount    || '';
    var totalPrice   = data.price || '';
    var imageUrl     = attrs.image ? 'https://www.caratlane.com' + attrs.image : '';

    // Build comprehensive text for AI
    var parts2 = [
      'Product Name: ' + (data.name || ''),
      'SKU: ' + (data.sku || ''),
      'Total Price: ' + totalPrice,
      'Gold Weight: ' + goldWeight + ' grams',
      'Diamond Weight: ' + diamondWt + ' carats',
      'Gold Purity: ' + purity,
      'Gold Rate Per Gram: ' + goldRate,
      'Diamond Rate: ' + diamondRate,
      'Making Charge: ' + makingCharge,
      'GST Amount: ' + gstAmount,
    ];

    // Add ALL attributes for AI to find more
    Object.keys(attrs).forEach(function(k) {
      if (attrs[k]) parts2.push(k + ': ' + attrs[k]);
    });

    return {
      title      : data.name || '',
      description: '',
      image      : imageUrl,
      text       : '[CARATLANE API] ' + parts2.join(' | ') + ' [ALL ATTRS] ' + JSON.stringify(attrs).slice(0, 5000),
    };
  } catch(e) {
    console.warn('[caratlane] Extractor error:', e.message);
    return null;
  }
}



async function scrapeProduct(url) {

  // ── ATTEMPT 0: CaratLane via ScrapingBee (proven to work, gets weight+price) ──
  if (url && url.indexOf('caratlane.com') !== -1 && process.env.SCRAPINGBEE_API_KEY) {
    try {
      console.log('[scraper] CaratLane: ScrapingBee attempt...');
      var nodehttps0 = require('https');
      var sbKey0     = process.env.SCRAPINGBEE_API_KEY;

      // Use premium proxy + India + wait 5s for React to render
      var sbUrl0 = 'https://app.scrapingbee.com/api/v1/?api_key=' + sbKey0
        + '&url=' + encodeURIComponent(url)
        + '&render_js=true'
        + '&premium_proxy=true'
        + '&country_code=in'
        + '&wait=5000'
        + '&block_resources=false';

      var sbHtml0 = await new Promise(function(resolve) {
        var req = nodehttps0.get(sbUrl0, { timeout: 60000 }, function(res) {
          var chunks = [];
          res.on('data', function(c) { chunks.push(c); });
          res.on('end', function() {
            var body = Buffer.concat(chunks).toString('utf8');
            console.log('[scraper] CaratLane SB0 status:', res.statusCode, 'chars:', body.length);
            resolve(res.statusCode === 200 ? body : '');
          });
          res.on('error', function() { resolve(''); });
        });
        req.on('error', function() { resolve(''); });
        req.on('timeout', function() { req.destroy(); resolve(''); });
      });

      if (sbHtml0 && sbHtml0.length > 1000) {
        // Get title and image
        var tM0  = sbHtml0.match(/<h1[^>]*>([^<]+)<\/h1>/i) || sbHtml0.match(/<title[^>]*>([^<|]+)/i);
        var t0   = tM0 ? tM0[1].replace(/&amp;/g,'&').trim() : '';
        var iM0  = sbHtml0.match(/property="og:image"[^>]+content="([^"]+)"/i) || sbHtml0.match(/content="([^"]+)"[^>]+property="og:image"/i);
        var i0   = iM0 ? iM0[1] : '';

        // Key: extract weight from "Set in 22 KT Yellow Gold(3.030 g)" pattern in og:description or page
        var ogDesc = sbHtml0.match(/property="og:description"[^>]+content="([^"]+)"/i) || sbHtml0.match(/name="description"[^>]+content="([^"]+)"/i);
        var descTxt = ogDesc ? ogDesc[1] : '';

        // Extract all text content
        // Limit HTML size before regex (4MB regex is slow/crashing)
        if (sbHtml0.length > 500000) sbHtml0 = sbHtml0.slice(0, 500000);
        var plain0 = sbHtml0
          .replace(/<script[\s\S]*?<\/script>/gi, ' ')
          .replace(/<style[\s\S]*?<\/style>/gi, ' ')
          .replace(/<[^>]+>/g, ' ')
          .replace(/&nbsp;/g,' ').replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>')
          .replace(/\s+/g, ' ').trim();

        // Log what we find for weight and pricing
        var weightInText = plain0.match(/\d+\.\d+\s*g[\sb)]/gi) || [];
        var rateInText   = plain0.match(/\d[\d,]+\s*\/\s*g/gi) || [];
        console.log('[scraper] Weight patterns:', weightInText.slice(0,5).join(' | '));
        console.log('[scraper] Rate patterns:', rateInText.slice(0,5).join(' | '));
        console.log('[scraper] Desc:', descTxt.slice(0,200));

        var n = function(s) { return s ? parseFloat((s+'').replace(/,/g,'')) : 0; };

        // Weight from og:description 'Set in 22 KT Yellow Gold(3.030 g)'
        var wFromDesc = descTxt.match(/\((\d+\.\d+)\s*g\)/i) || plain0.match(/\((\d+\.\d+)\s*g\)/i);
        var extractedWeight = wFromDesc ? parseFloat(wFromDesc[1]) : 0;

        // Rate from page header '22 KT (916) : 13,269.00' or price breakup '13,411 / g'
        var rateM1 = plain0.match(/(\d[\d,]+\.?\d*)\s*\/\s*g[^\d]{0,20}(\d[\d,]+)/i);
        var rateM2 = plain0.match(/22\s*KT[^\d]{0,10}(\d[\d,]+\.?\d*)\s*\/\s*g/i) ||
                     plain0.match(/916[^\d]{0,5}(\d[\d,]+\.?\d*)\s*\/\s*g/i) ||
                     plain0.match(/22\s*KT[^₹\d]{0,10}[₹Rs.]*(\d[\d,]+)/i);
        var extractedRate   = rateM1 ? n(rateM1[1]) : (rateM2 ? n(rateM2[1]) : 0);
        var extractedGoldVal= rateM1 ? n(rateM1[2]) : 0;

        // Calculate gold value if missing
        if (extractedRate > 0 && extractedWeight > 0 && extractedGoldVal === 0) {
          extractedGoldVal = Math.round(extractedRate * extractedWeight);
          console.log('[scraper] Calculated goldVal:', extractedGoldVal);
        }

        var makingM    = plain0.match(/Making\s*Charge[^\d]+(\d[\d,]+)/i);
        var taxM       = plain0.match(/\bTAX[^\d]+(\d[\d,]+)/i) || plain0.match(/\bGST[^\d]+(\d[\d,]+)/i);
        var totalM     = plain0.match(/Grand\s*Total[^\d]+(\d[\d,]+)/i);
        // Only use MRP if no grand total found AND value > 1000 (not ₹22)
        if (!totalM) {
          var mrpM = plain0.match(/MRP[^\d]+(\d[\d,]+)/i);
          if (mrpM && parseFloat(mrpM[1].replace(/,/g,'')) > 1000) totalM = mrpM;
        }

        var makingAmt = makingM ? n(makingM[1]) : 0;
        var taxAmt    = taxM   ? n(taxM[1])   : 0;
        var totalAmt  = totalM ? n(totalM[1]) : 0;

        // Sanity: tax must be > 100 (not ₹22)
        if (taxAmt < 100) taxAmt = 0;

        var directEx = {
          weight : extractedWeight,
          rate   : extractedRate,
          goldVal: extractedGoldVal,
          making : makingAmt,
          gst    : taxAmt,
          price  : totalAmt,
        };
        console.log('[scraper] CaratLane direct extract:', JSON.stringify(directEx));

        // Try to get total price from meta tags - CaratLane puts it there
        var ogPrice = sbHtml0.match(/product:price:amount"[^>]+content="([\d.]+)"/i)
                   || sbHtml0.match(/content="([\d.]+)"[^>]+property="product:price:amount"/i)
                   || sbHtml0.match(/"price"\s*content="([\d.]+)"/i);
        var ogPriceVal = ogPrice ? parseFloat(ogPrice[1]) : 0;

        // Also search in JSON-LD
        var jldM = sbHtml0.match(/"price"\s*:\s*"?([\d.]+)"?/);
        var jldPrice = jldM ? parseFloat(jldM[1]) : 0;

        // Use whichever is reasonable (> 1000)
        var metaTotal = ogPriceVal > 1000 ? ogPriceVal : (jldPrice > 1000 ? jldPrice : 0);
        if (metaTotal > 0) {
          console.log('[scraper] Found total from meta/JSON-LD:', metaTotal);
          directEx.price = metaTotal;
        }

        var fullText0 = '[DESCRIPTION] ' + descTxt + ' TOTAL_PRICE:' + metaTotal + ' [PAGE] ' + plain0.slice(0, 20000);
        var result0   = { title: t0 || 'CaratLane Product', description: descTxt, image: i0, text: fullText0 };
        result0._directExtract = directEx;
        return result0;
      }
      console.log('[scraper] CaratLane SB0 thin, falling through');
    } catch(err0) {
      console.warn('[scraper] CaratLane SB0 error:', err0.message);
    }
  }

  // ── ATTEMPT 1: ScrapingBee ────────────────────────────────────────────────────
  if (process.env.SCRAPINGBEE_API_KEY) {
    try {
      console.log('[scraper] Trying ScrapingBee...');
      var nodehttps = require('https');
      var sbKey  = process.env.SCRAPINGBEE_API_KEY;
      // Try stealth proxy first (best for CaratLane, Tanishq etc)
      // Build ScrapingBee URL with site-specific settings
      var sbWait = '2000';
      var sbExtra = '';

      if (url.indexOf('caratlane.com') !== -1) {
        // CaratLane: longer wait + India location
        sbWait  = '5000';
        sbExtra = '&country_code=in';
      }

      var sbUrl  = 'https://app.scrapingbee.com/api/v1/?api_key=' + sbKey
                 + '&url=' + encodeURIComponent(url)
                 + '&render_js=true'
                 + '&premium_proxy=true'
                 + '&country_code=in'
                 + '&wait=' + sbWait
                 + '&block_ads=true'
                 + sbExtra;

      var sbHtml = await new Promise(function(resolve, reject) {
        var req = nodehttps.get(sbUrl, { timeout: 45000 }, function(res) {
          var chunks = [];
          res.on('data', function(c) { chunks.push(c); });
          res.on('end', function() {
            var body = Buffer.concat(chunks).toString('utf8');
            if (res.statusCode === 200) resolve(body);
            else reject(new Error('ScrapingBee ' + res.statusCode + ': ' + body.slice(0,150)));
          });
          res.on('error', reject);
        });
        req.on('error', reject);
        req.on('timeout', function() { req.destroy(); reject(new Error('ScrapingBee timeout')); });
      });

      if (sbHtml && sbHtml.length > 500) {
        var tMatch = sbHtml.match(/<h1[^>]*>([^<]+)<\/h1>/i) || sbHtml.match(/<title[^>]*>([^<|]+)/i);
        var title  = tMatch ? tMatch[1].replace(/&amp;/g,'&').trim() : '';
        var ogImg  = sbHtml.match(/property="og:image"[^>]+content="([^"]+)"/i) || sbHtml.match(/content="([^"]+)"[^>]+property="og:image"/i);
        var image  = ogImg ? ogImg[1] : '';
        var ogDesc = sbHtml.match(/name="description"[^>]+content="([^"]+)"/i);
        var desc   = ogDesc ? ogDesc[1] : '';
        var jldAll = sbHtml.match(/<script[^>]+type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi) || [];
        var jld    = jldAll.map(function(s){ return s.replace(/<[^>]+>/g,''); }).join(' ').slice(0, 8000);
        var plain  = sbHtml
          .replace(/<script[\s\S]*?<\/script>/gi, ' ')
          .replace(/<style[\s\S]*?<\/style>/gi, ' ')
          .replace(/<[^>]+>/g, ' ')
          .replace(/&nbsp;/g,' ').replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>')
          .replace(/\s+/g, ' ').trim().slice(0, 20000);

        if (plain.length > 300) {
          console.log('[scraper] ScrapingBee succeeded, chars:', plain.length);
          
          // Extract pricing table specifically (works for Bhima, Malabar, PNG)
          var pricingTableMatch = sbHtml.match(/<table[^>]*>([\s\S]*?)<\/table>/gi) || [];
          var pricingText = '';
          pricingTableMatch.forEach(function(t) {
            var tText = t.replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').trim();
            if (/gold|making|weight|rate|value|gst|total/i.test(tText)) {
              pricingText += '[PRICING TABLE] ' + tText + ' ';
            }
          });
          
          // Extract spec tables (Net Weight, Purity etc)
          var specText = '';
          var specMatches = sbHtml.match(/(?:Net Weight|Gold Weight|Gross Weight|Weight|Purity|Making)[^<]{0,5}<[^>]+>[^<]{0,30}/gi) || [];
          specText = specMatches.join(' ');

          // Log key data for debugging
          var weightInText = plain.match(/(\d+\.?\d*)\s*(?:gms?|grams?|g\b)/gi) || [];
          console.log('[scraper] Weight mentions found:', weightInText.slice(0,5).join(', '));
          console.log('[scraper] Pricing tables found:', pricingTableMatch.length);
          
          var fullText = '[SPECIFICATIONS]\n' + specText + '\n\n[PRICING TABLE]\n' + pricingText + '\n\n[PAGE TEXT]\n' + plain + '\n\n[STRUCTURED DATA]\n' + jld;
          return { title: title, description: desc, image: image, text: fullText.slice(0, 25000) };
        }
      }
      throw new Error('ScrapingBee returned thin content');
    } catch (sbErr) {
      console.warn('[scraper] ScrapingBee failed:', sbErr.message);
      
      // If limit reached, try ScrapingBee without premium proxy (uses fewer credits)
      if (sbErr.message && sbErr.message.indexOf('limit') !== -1) {
        console.log('[scraper] Trying ScrapingBee basic (no premium)...');
        try {
          var sbUrl2 = 'https://app.scrapingbee.com/api/v1/?api_key=' + sbKey +
                       '&url=' + encodeURIComponent(url) +
                       '&render_js=true&wait=2000';
          var sbHtml2 = await new Promise(function(resolve, reject) {
            var req = nodehttps.get(sbUrl2, { timeout: 30000 }, function(res) {
              var chunks = [];
              res.on('data', function(c) { chunks.push(c); });
              res.on('end', function() {
                var body = Buffer.concat(chunks).toString('utf8');
                if (res.statusCode === 200) resolve(body);
                else reject(new Error('SB basic ' + res.statusCode + ': ' + body.slice(0,100)));
              });
              res.on('error', reject);
            });
            req.on('error', reject);
            req.on('timeout', function() { req.destroy(); reject(new Error('timeout')); });
          });
          if (sbHtml2 && sbHtml2.length > 500) {
            var tMatch2 = sbHtml2.match(/<h1[^>]*>([^<]+)<\/h1>/i) || sbHtml2.match(/<title[^>]*>([^<|]+)/i);
            var title2  = tMatch2 ? tMatch2[1].replace(/&amp;/g,'&').trim() : '';
            var ogImg2  = sbHtml2.match(/property="og:image"[^>]+content="([^"]+)"/i);
            var image2  = ogImg2 ? ogImg2[1] : '';
            var jldAll2 = sbHtml2.match(/<script[^>]+type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi) || [];
            var jld2    = jldAll2.map(function(s){ return s.replace(/<[^>]+>/g,''); }).join(' ').slice(0, 8000);
            var pricingTables2 = sbHtml2.match(/<table[^>]*>([\s\S]*?)<\/table>/gi) || [];
            var pricingText2 = '';
            pricingTables2.forEach(function(t) {
              var tt = t.replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').trim();
              if (/gold|making|weight|rate|value|gst|total/i.test(tt)) pricingText2 += '[PRICING TABLE] ' + tt + ' ';
            });
            var plain2 = sbHtml2.replace(/<script[\s\S]*?<\/script>/gi,' ').replace(/<style[\s\S]*?<\/style>/gi,' ').replace(/<[^>]+>/g,' ').replace(/&nbsp;/g,' ').replace(/\s+/g,' ').trim().slice(0,20000);
            if (plain2.length > 300) {
              console.log('[scraper] ScrapingBee basic succeeded');
              return { title: title2, description: '', image: image2, text: '[PRICING TABLE] ' + pricingText2 + ' [PAGE TEXT] ' + plain2 + ' [STRUCTURED DATA] ' + jld2 };
            }
          }
        } catch(sbErr2) {
          console.warn('[scraper] ScrapingBee basic also failed:', sbErr2.message);
        }
      }
    }
  }

  // ── ATTEMPT 2: Direct Playwright ─────────────────────────────────────────────
  try {
    console.log('[scraper] Trying direct Playwright...');
    var browser = await getBrowser();
    var product = await scrapePage(url, browser);
    if ((product.text || '').trim().length > 200 || (product.title || '').trim().length > 3) {
      console.log('[scraper] Direct succeeded');
      return product;
    }
    console.log('[scraper] Direct returned thin content');
  } catch (err) {
    console.warn('[scraper] Direct failed:', err.message);
    _browserInstance = null;
  }

  // ── ATTEMPT 3: BrightData Proxy ───────────────────────────────────────────────
  var hasProxy = !!(process.env.BRIGHTDATA_USERNAME && process.env.BRIGHTDATA_PASSWORD);
  if (hasProxy) {
    var proxyBrowser = null;
    try {
      console.log('[scraper] Trying BrightData proxy...');
      proxyBrowser = await chromium.launch({
        headless: true,
        args: ['--no-sandbox','--disable-setuid-sandbox','--disable-dev-shm-usage','--ignore-certificate-errors','--ignore-ssl-errors'],
        proxy: {
          server  : 'http://' + process.env.BRIGHTDATA_HOST + ':' + process.env.BRIGHTDATA_PORT,
          username: process.env.BRIGHTDATA_USERNAME,
          password: process.env.BRIGHTDATA_PASSWORD,
        },
      });
      var p3 = await scrapePage(url, proxyBrowser);
      console.log('[scraper] BrightData succeeded');
      return p3;
    } catch (err3) {
      console.warn('[scraper] BrightData failed:', err3.message);
    } finally {
      if (proxyBrowser) { try { await proxyBrowser.close(); } catch(e) {} }
    }
  }

  // ── ATTEMPT 4: Jina AI ───────────────────────────────────────────────────────
  try {
    console.log('[scraper] Trying Jina AI...');
    var nodehttps4 = require('https');
    var jinaText   = await new Promise(function(resolve, reject) {
      var req = nodehttps4.get('https://r.jina.ai/' + url, {
        headers: { 'User-Agent':'Mozilla/5.0','Accept':'text/plain','X-Return-Format':'text' },
        timeout: 20000,
      }, function(res) {
        var chunks = [];
        res.on('data', function(c) { chunks.push(c); });
        res.on('end',  function()  { resolve(Buffer.concat(chunks).toString('utf8')); });
        res.on('error', reject);
      });
      req.on('error', reject);
      req.on('timeout', function() { req.destroy(); reject(new Error('Jina timeout')); });
    });
    if (jinaText && jinaText.length > 300 && !jinaText.includes('not in allowlist')) {
      var tl = jinaText.match(/^Title:\s*(.+)$/m);
      var il = jinaText.match(/!\[.*?\]\((https?:\/\/[^\)\s]+)\)/);
      console.log('[scraper] Jina succeeded');
      return { title: tl ? tl[1].trim() : '', description: '', image: il ? il[1] : '', text: jinaText.slice(0,20000) };
    }
    throw new Error('Jina insufficient content');
  } catch (jinaErr) {
    console.warn('[scraper] Jina failed:', jinaErr.message);
  }

  throw new Error('Could not extract content. Please enter the gold weight manually in the box shown.');
}


// ── OpenAI ────────────────────────────────────────────────────────────────────

var AI_SYSTEM_PROMPT = `You extract jewellery pricing data from Indian jewellery website text. Return ONLY valid JSON, no markdown.

CARATLANE EXACT FORMAT (learn this):
Page shows: "Set in 22 KT Yellow Gold(4.580 g)" → gold_weight=4.580, purity=22K
Price breakup tab shows:
"22 Kt Yellow Gold ₹13,411/g  ₹61,422" → gold_rate_per_gram=13411, website_gold_value=61422
"Making Charge ₹13,267" → website_making_charge=13267
"TAX ₹2,241" → website_gst=2241
"Grand Total ₹76,930" → website_total=76930

BHIMA EXACT FORMAT:
Table: "Gold 22K | Rate:13269 | Weight:22 | Value:2,91,918" → gold_rate=13269, gold_weight=22, website_gold_value=291918
"Making Charges | Value:51,085" → website_making_charge=51085
"GST | Value:10,290" → website_gst=10290
"Grand Total | 3,22,643" → website_total=322643

TANISHQ FORMAT: "Net Wt: 5.2g | Gold Rate: ₹X | Making: Y%"
MALABAR FORMAT: "Gold Weight: Xg | Rate: ₹Y/g | Making: Z%"

RULES:
- gold_weight: grams number only. In CaratLane look for "(4.580 g)" or "4.58g" near metal type
- purity: 22KT/22K/916=22K, 18KT/18K/750=18K, 14KT/14K/585=14K
- gold_rate_per_gram: rate PER GRAM (e.g. 13411). NOT total price. Look for "/g" or "/gram"
- website_gold_value: ONLY the gold metal value (e.g. 61422). NOT the total/grand total
- website_making_charge: making charge amount (e.g. 13267)
- website_gst: tax/GST amount (e.g. 2241)
- website_total: Grand Total / final price (e.g. 76930)
- website_stone_value: diamond/stone value only
- stones: array of {stone_type, weight, weight_unit, website_stone_value}
- Numbers only — no ₹ commas symbols
- Empty string "" if not found
- jewellery_type: ring/earring/necklace/chain/bangle/bracelet/pendant/mangalsutra/anklet

JSON format:
{"product_name":"","metal":"Gold","purity":"","jewellery_type":"","gold_weight":"","stones":[],"gold_rate_per_gram":"","website_gold_value":"","website_stone_value":"","website_making_charge":"","website_gst":"","website_total":""}`;


var IMG_SYSTEM_PROMPT = 'You are a jewellery expert. Analyse this jewellery image and return ONLY valid JSON — no markdown.\n\nReturn this exact JSON:\n{\n  "product_name": "",\n  "metal": "",\n  "purity": "",\n  "jewellery_type": "",\n  "gold_weight": "",\n  "stones": [\n    {\n      "stone_type": "",\n      "weight": "",\n      "weight_unit": "carat or gram",\n      "carat_grade": "",\n      "colour": "",\n      "clarity": ""\n    }\n  ],\n  "gold_rate_per_gram": "",\n  "website_gold_value": "",\n  "website_making_charge": "",\n  "website_gst": "",\n  "website_total": "",\n  "ai_notes": ""\n}\n\nRules:\n- Estimate gold_weight visually based on item size and type\n- Identify ALL stones visible — list each separately\n- weight_unit: carat for precious, gram for others\n- ai_notes: briefly explain estimates\n- JSON only';

async function extractWithAI(product) {
  var response = await openai.chat.completions.create({
    model      : 'gpt-4.1-mini',
    max_tokens : 1000,
    temperature: 0,
    messages: [
      { role: 'system', content: AI_SYSTEM_PROMPT },
      { role: 'user',   content: 'Product Title: ' + product.title + '\nDescription: ' + product.description + '\nPage Text:\n' + product.text },
    ],
  });
  var raw = response.choices[0].message.content || '';
  try { return JSON.parse(raw.replace(/```json|```/gi, '').trim()); }
  catch(e) { return { raw_response: raw }; }
}

async function extractFromImage(base64Image, mimeType) {
  var response = await openai.chat.completions.create({
    model      : 'gpt-4.1-mini',
    max_tokens : 1000,
    temperature: 0,
    messages: [
      { role: 'system', content: IMG_SYSTEM_PROMPT },
      { role: 'user', content: [
        { type: 'image_url', image_url: { url: 'data:' + mimeType + ';base64,' + base64Image } },
        { type: 'text', text: 'Analyse this jewellery and extract all pricing and stone information.' },
      ]},
    ],
  });
  var raw = response.choices[0].message.content || '';
  try { return JSON.parse(raw.replace(/```json|```/gi, '').trim()); }
  catch(e) { return { raw_response: raw }; }
}

// ── Routes ────────────────────────────────────────────────────────────────────

app.get('/',       function(req, res) { res.sendFile(path.join(__dirname, 'public', 'index.html')); });
app.get('/health', function(req, res) { res.json({ status: 'running', timestamp: new Date().toISOString() }); });
app.get('/test-ai',function(req, res) {
  res.json({ success: true, openai: process.env.OPENAI_API_KEY ? 'FOUND' : 'MISSING', bright_user: process.env.BRIGHTDATA_USERNAME ? 'FOUND' : 'MISSING' });
});

app.get('/rates', function(req, res) { res.json({ success: true, rates: getRates() }); });

app.post('/rates', function(req, res) {
  if (!req.body || typeof req.body !== 'object') return res.status(400).json({ success: false, error: 'Invalid payload.' });
  saveRates(Object.assign({}, loadRates(), req.body));
  res.json({ success: true, rates: getRates() });
});

app.delete('/rates', function(req, res) {
  if (fs.existsSync(RATES_FILE)) fs.unlinkSync(RATES_FILE);
  res.json({ success: true, rates: getRates() });
});

app.post('/analyse-product', analysisLimiter, async function(req, res) {
  var url = req.body.url;
  if (!url || typeof url !== 'string' || !isValidUrl(url)) {
    return res.status(400).json({ success: false, error: 'A valid HTTP/HTTPS URL is required.' });
  }
  try {
    var rates   = getRates();
    // Scrape and AI extraction run sequentially (AI needs scrape result)
    var product = await scrapeProduct(url);
    // If scraper attached direct extract (CaratLane NEXT_DATA), store on product
    if (product && product._directExtract) {
    }
    if (!product.text && !product.title) {
      return res.status(422).json({ success: false, error: 'Could not extract content from this page.' });
    }

    // ── PRE-AI: Direct regex extraction for CaratLane ──────────────────────
    // Use direct extract from scraper if available (CaratLane NEXT_DATA)
    if (product._directExtract) {
      product._directExtract = product._directExtract; // already set
    }
    if (req.body && req.body.url && (req.body.url || '').indexOf('caratlane.com') !== -1 && product.text) {
      var _txt = product.text;
      // Weight: "Set in 22 KT Yellow Gold(3.030 g)"
      // Weight
      var _wm  = _txt.match(/\((\d+\.\d+)\s*g\)/i)
              || _txt.match(/(\d+\.\d+)\s*g\b/i)
              || _txt.match(/Net\s*Weight[^\d]+(\d+\.?\d*)/i);

      // Gold rate: "13,411 / g" pattern
      var _rm  = _txt.match(/(\d[\d,]{3,})\s*\/\s*g/i)
              || _txt.match(/Gold\s*Rate[^\d]+(\d[\d,]+)/i);

      // Gold value: after rate pattern "XXXXX / g  YYYYYY"
      var _rvm = _txt.match(/(\d[\d,]{3,})\s*\/\s*g[^\d]{0,20}(\d[\d,]{3,})/i);

      // Making charge
      var _mm  = _txt.match(/Making\s*Charge[^\d]+(\d[\d,]+)/i)
              || _txt.match(/Making[^\d]+(\d[\d,]+)/i);

      // Tax
      var _tm  = _txt.match(/\bTAX[^\d]+(\d[\d,]+)/i)
              || _txt.match(/\bGST[^\d]+(\d[\d,]+)/i);

      // Grand total
      var _gtm = _txt.match(/Grand\s*Total[^\d]+(\d[\d,]+)/i)
              || _txt.match(/Total[^\d]{0,10}(\d[\d,]{4,})/i);

      var _n = function(s) { return s ? parseFloat(s.replace(/,/g,'')) : 0; };

      if (_wm || _rm) {
        var _de = {
          w: _wm  ? parseFloat(_wm[1])                         : 0,
          r: _rm  ? _n(_rm[1])                                  : 0,
          v: _rvm ? _n(_rvm[2])                                 : 0,  // gold value from "rate/g  value"
          m: _mm  ? _n(_mm[1])                                  : 0,
          t: _tm  ? _n(_tm[1])                                  : 0,
          g: _gtm ? _n(_gtm[1])                                 : 0,
        };
        // Validate: gold value must be less than total and > rate
        if (_de.v > 0 && _de.g > 0 && _de.v >= _de.g) { _de.v = 0; } // v can't be >= total
        if (_de.t > 0 && _de.g > 0 && _de.t >= _de.g) { _de.t = 0; } // tax can't be >= total
        // Store for merging after AI
        product._directExtract = _de;
      }
    }
    // ────────────────────────────────────────────────────────────────────────

    var ai = await extractWithAI(product);
    // Merge direct CaratLane extraction — beats AI for accuracy
    var _de = product._directExtract || null;
    if (_de) {
      // From regex parsing of page text (old format: r,v,w,m,t,g)
      if (_de.r > 0 && _de.r < 20000) ai.gold_rate_per_gram    = String(_de.r);
      if (_de.v > 0)                   ai.website_gold_value    = String(_de.v);
      if (_de.w > 0)                   ai.gold_weight           = _de.w;
      if (_de.m > 0)                   ai.website_making_charge = String(_de.m);
      if (_de.t > 0)                   ai.website_gst           = String(_de.t);
      if (_de.g > 0)                   ai.website_total         = String(_de.g);
      // From NEXT_DATA scraper extract (new format: weight,rate,goldVal,making,gst,price)
      if (_de.weight  > 0)             ai.gold_weight           = _de.weight;
      if (_de.rate    > 0 && _de.rate < 20000) ai.gold_rate_per_gram = String(_de.rate);
      if (_de.goldVal > 0)             ai.website_gold_value    = String(_de.goldVal);
      if (_de.making  > 0)             ai.website_making_charge = String(_de.making);
      if (_de.gst     > 0)             ai.website_gst           = String(_de.gst);
      if (_de.price   > 1000)          ai.website_total         = String(_de.price);  // must be > 1000
      if (_de.purityStr)               ai.purity                = _de.purityStr;
      console.log('[direct] Merged: rate=' + ai.gold_rate_per_gram + ' val=' + ai.website_gold_value + ' wt=' + ai.gold_weight + ' making=' + ai.website_making_charge);
    }

    // ── CaratLane: fill store price using weight + live rate ─────────────────
    if (req.body && req.body.url && (req.body.url||'').indexOf('caratlane.com') !== -1) {
      var clWeight = parseFloat(ai.gold_weight) || 0;
      var clRate   = parseFloat(ai.gold_rate_per_gram) || 0;
      var clTotal  = parseFloat(ai.website_total) || 0;

      if (clWeight > 0 && clRate === 0) {
        // Try CaratLane live rate API first
        var liveRate = 0;
        try { liveRate = await fetchCaratLaneRate(); } catch(e) {}

        // Fallback: use our own 22K rate (within 1-2% of CaratLane rate)
        if (!liveRate || liveRate < 5000) {
          var ourRates = getRates();
          liveRate = ourRates.gold_22k || 0;
          console.log('[caratlane] Using our 22K rate as fallback:', liveRate);
        } else {
          console.log('[caratlane] Got live rate:', liveRate);
        }

        if (liveRate > 0) {
          ai.gold_rate_per_gram = String(liveRate);
          var clGoldVal = Math.round(liveRate * clWeight);
          ai.website_gold_value = String(clGoldVal);

          // If we also have total, back-calc making and GST
          // Formula: total = (goldVal + making) * 1.03
          if (clTotal > clGoldVal) {
            var goldPlusMaking = Math.round(clTotal / 1.03);
            var derivedMaking  = goldPlusMaking - clGoldVal;
            var derivedGst     = clTotal - goldPlusMaking;
            if (derivedMaking > 0 && derivedMaking < clGoldVal * 2) {
              ai.website_making_charge = String(derivedMaking);
              ai.website_gst           = String(derivedGst);
              console.log('[caratlane] Filled: rate=' + liveRate + ' goldVal=' + clGoldVal + ' making=' + derivedMaking + ' gst=' + derivedGst + ' total=' + clTotal);
            }
          } else {
            console.log('[caratlane] Filled: rate=' + liveRate + ' goldVal=' + clGoldVal + ' (no total for making calc)');
          }
        }
      }
    }


    // ── POST-AI SANITY CHECK ─────────────────────────────────────────────────
    (function fixAI() {
      var total   = parseFloat(ai.website_total)         || 0;
      var goldVal = parseFloat(ai.website_gold_value)    || 0;
      var rate    = parseFloat(ai.gold_rate_per_gram)    || 0;
      var weight  = parseFloat(ai.gold_weight)           || 0;
      var making  = parseFloat(ai.website_making_charge) || 0;
      var gst     = parseFloat(ai.website_gst)           || 0;

      // CASE: Only total available — clear derived fields (only for CaratLane)
      if (total > 0 && goldVal === 0 && rate === 0 && req && req.body && req.body.url && (req.body.url||"").indexOf("caratlane.com") !== -1) {
        console.log("[fix] CaratLane only-total: clearing derived fields");
        ai.gold_rate_per_gram    = "";
        ai.website_gold_value    = "";
        ai.website_making_charge = "";
        ai.website_gst           = "";
        return;
      }


      // CASE: gold_value is suspiciously close to total — must be wrong
      if (goldVal > 0 && total > 0 && goldVal > total * 0.85) {
        console.log('[fix] gold_value too close to total, clearing:', goldVal, 'vs total:', total);
        ai.website_gold_value = '';
        goldVal = 0;
      }

      // CASE: gold_value looks like total (AI confused them)
      if (goldVal > 0 && total > 0 && goldVal >= total * 0.9) {
        console.log('[fix] gold_value ≈ total, clearing gold_value:', goldVal);
        ai.website_gold_value = '';
        goldVal = 0;
      }

      // CASE: rate too high — clear it
      if (rate > 20000) {
        console.log('[fix] rate too high:', rate, '— clearing');
        ai.gold_rate_per_gram = '';
        rate = 0;
      }

      // CASE: Have weight + goldVal but no rate → derive rate
      weight = parseFloat(ai.gold_weight) || 0;
      goldVal= parseFloat(ai.website_gold_value) || 0;
      rate   = parseFloat(ai.gold_rate_per_gram) || 0;
      if (weight > 0 && goldVal > 0 && rate === 0) {
        var derivedRate = Math.round(goldVal / weight);
        if (derivedRate > 0 && derivedRate < 20000) {
          ai.gold_rate_per_gram = String(derivedRate);
          console.log('[fix] Derived rate from goldVal/weight:', derivedRate);
        }
      }
    })();
    // ─────────────────────────────────────────────────────────────────────────


    if (!ai.jewellery_type) { ai.jewellery_type = detectJewelleryType((ai.product_name || '') + ' ' + product.title); }
    var pricing = calculateSaheehisabPrice(ai, rates);
    var data = Object.assign({
      product_name  : ai.product_name  || product.title || 'Unknown Product',
      metal         : ai.metal         || 'Gold',
      purity        : ai.purity        || '22K',
      jewellery_type: pricing.jewellery_label,
      jewellery_key : pricing.jewellery_key,
      gold_weight   : ai.gold_weight   || '0',
      stones        : ai.stones        || [],
      ai_raw        : ai.raw_response  || undefined,
    }, pricing);
    // Save product image permanently
    var savedImageUrl = product.image || '';
    if (product.image && product.image.startsWith('http')) {
      try {
        var imgBuf = await downloadImage(product.image);
        if (imgBuf) savedImageUrl = saveImageFile(imgBuf, '.jpg');
      } catch(e) { savedImageUrl = product.image; }
    }

    // Create share record
    var shareId   = Date.now().toString(36) + Math.random().toString(36).slice(2,6);
    var shareData = {
      id             : shareId,
      type           : 'url',
      source_url     : url,
      image_url      : savedImageUrl,
      product_name   : data.product_name,
      jewellery_type : data.jewellery_type,
      metal          : data.metal,
      purity         : data.purity,
      gold_weight    : data.gold_weight,
      website_price  : data.website_price,
      saheehisab_price: data.saheehisab_price,
      estimated_savings: data.estimated_savings,
      stones         : (data.stone_breakdown || []).map(function(s){ return s.stone_type + ' ' + s.weight + (s.weight_unit||'ct'); }).join(', '),
      created_at     : new Date().toISOString(),
    };
    saveShare(shareId, shareData);

    // Save lead
    saveLead(Object.assign({ client: getClientInfo(req), image_url: savedImageUrl, share_id: shareId }, shareData));

    return res.json({ success: true, image: savedImageUrl || product.image || '', share_id: shareId, data: data });
  } catch (err) {
    console.error('[/analyse-product]', err.message);
    return res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/analyse-image', analysisLimiter, upload.single('image'), async function(req, res) {
  if (!req.file) return res.status(400).json({ success: false, error: 'No image file provided.' });
  var filePath = req.file.path;
  try {
    var rates  = getRates();
    var buf    = await sharp(filePath).resize({ width: 1280, withoutEnlargement: true }).jpeg({ quality: 80 }).toBuffer();
    var b64    = buf.toString('base64');
    var ai     = await extractFromImage(b64, 'image/jpeg');
    if (!ai.jewellery_type) { ai.jewellery_type = detectJewelleryType(ai.product_name || ''); }
    var pricing = calculateSaheehisabPrice(ai, rates);
    var data = Object.assign({
      product_name  : ai.product_name  || 'Uploaded Jewellery',
      metal         : ai.metal         || 'Gold',
      purity        : ai.purity        || '22K',
      jewellery_type: pricing.jewellery_label,
      jewellery_key : pricing.jewellery_key,
      gold_weight   : ai.gold_weight   || '0',
      stones        : ai.stones        || [],
      ai_notes      : ai.ai_notes      || '',
      ai_raw        : ai.raw_response  || undefined,
    }, pricing);
    // Save uploaded image permanently
    var savedImgPath = saveImageFile(buf, '.jpg');

    // Create share record
    var shareId2   = Date.now().toString(36) + Math.random().toString(36).slice(2,6);
    var shareData2 = {
      id             : shareId2,
      type           : 'image',
      source_url     : 'image-upload',
      image_url      : savedImgPath,
      product_name   : data.product_name,
      jewellery_type : data.jewellery_type,
      metal          : data.metal,
      purity         : data.purity,
      gold_weight    : data.gold_weight,
      website_price  : data.website_price,
      saheehisab_price: data.saheehisab_price,
      estimated_savings: data.estimated_savings,
      stones         : (data.stone_breakdown || []).map(function(s){ return s.stone_type + ' ' + s.weight + (s.weight_unit||'ct'); }).join(', '),
      created_at     : new Date().toISOString(),
    };
    saveShare(shareId2, shareData2);

    // Save lead with image path
    saveLead(Object.assign({ client: getClientInfo(req), image_url: savedImgPath, share_id: shareId2 }, shareData2));

    return res.json({ success: true, image: savedImgPath, share_id: shareId2, data: data });
  } catch (err) {
    console.error('[/analyse-image]', err.message);
    return res.status(500).json({ success: false, error: err.message });
  } finally {
    try { fs.unlinkSync(filePath); } catch(e) {}
  }
});


// ── Route: POST /identify-image (Step 1 — identify only, no pricing) ──────────

app.post('/identify-image', analysisLimiter, upload.single('image'), async function(req, res) {
  if (!req.file) return res.status(400).json({ success: false, error: 'No image file provided.' });
  var filePath = req.file.path;
  try {
    var buf = await sharp(filePath).resize({ width: 1280, withoutEnlargement: true }).jpeg({ quality: 80 }).toBuffer();
    var b64 = buf.toString('base64');

    var systemPrompt = 'You are a jewellery expert. Identify the jewellery in this image. Return ONLY valid JSON no markdown: {"product_name":"","jewellery_type":"ring or necklace or earrings or bangle or chain or pendant or bracelet or jhumka or anklet or temple or kundan or plain","metal":"Gold or Silver or Platinum","purity":"22K or 18K or 24K or 14K","estimated_gold_weight":"","stones":[{"stone_type":"","estimated_weight":"","weight_unit":"carat or gram","colour":"","clarity":""}],"ai_notes":"","confidence":"low or medium or high"}. Rules: estimated_gold_weight in grams visual estimate. List every visible stone. JSON only.';
    var response = await openai.chat.completions.create({
      model: 'gpt-4.1-mini',
      max_tokens: 800,
      temperature: 0,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: [
          { type: 'image_url', image_url: { url: 'data:image/jpeg;base64,' + b64 } },
          { type: 'text', text: 'Identify this jewellery and estimate what you can see.' },
        ]},
      ],
    });

    var raw = response.choices[0].message.content || '';
    var ai;
    try { ai = JSON.parse(raw.replace(/```json|```/gi, '').trim()); }
    catch(e) { return res.status(500).json({ success: false, error: 'AI could not parse the image.' }); }

    return res.json({
      success : true,
      image   : 'data:image/jpeg;base64,' + b64,
      identified: {
        product_name    : ai.product_name    || 'Jewellery',
        jewellery_type  : ai.jewellery_type  || 'plain',
        metal           : ai.metal           || 'Gold',
        purity          : ai.purity          || '22K',
        estimated_gold_weight: ai.estimated_gold_weight || '',
        stones          : ai.stones          || [],
        ai_notes        : ai.ai_notes        || '',
        confidence      : ai.confidence      || 'low',
      },
    });
  } catch (err) {
    console.error('[/identify-image]', err.message);
    return res.status(500).json({ success: false, error: err.message });
  } finally {
    try { fs.unlinkSync(filePath); } catch(e) {}
  }
});

// ── Route: POST /calculate-manual (Step 2 — calculate from user inputs) ───────

app.post('/calculate-manual', function(req, res) {
  try {
    var rates  = getRates();
    var body   = req.body;

    // Build AI-like object from manual inputs
    var ai = {
      product_name    : body.product_name    || 'Jewellery',
      metal           : body.metal           || 'Gold',
      purity          : body.purity          || '22K',
      jewellery_type  : body.jewellery_type  || 'plain',
      gold_weight     : body.gold_weight     || '0',
      website_total   : body.website_price   || '0',
      website_gold_value   : '0',
      website_making_charge: '0',
      website_gst          : '0',
      gold_rate_per_gram   : '0',
      stones: Array.isArray(body.stones) ? body.stones : [],
    };

    var pricing = calculateSaheehisabPrice(ai, rates);

    var data = Object.assign({
      product_name  : ai.product_name,
      metal         : ai.metal,
      purity        : ai.purity,
      jewellery_type: pricing.jewellery_label,
      jewellery_key : pricing.jewellery_key,
      gold_weight   : ai.gold_weight,
      stones        : ai.stones,
      source        : 'manual',
    }, pricing);

    return res.json({ success: true, data: data });
  } catch (err) {
    console.error('[/calculate-manual]', err.message);
    return res.status(500).json({ success: false, error: err.message });
  }
});

// ── Route: POST /analyse-invoice (Option B — read bill/invoice image) ─────────

app.post('/analyse-invoice', analysisLimiter, upload.single('image'), async function(req, res) {
  if (!req.file) return res.status(400).json({ success: false, error: 'No invoice image provided.' });
  var filePath = req.file.path;
  try {
    var buf = await sharp(filePath).resize({ width: 1920, withoutEnlargement: true }).jpeg({ quality: 90 }).toBuffer();
    var b64 = buf.toString('base64');

    var systemPrompt = 'You are an expert at reading Indian jewellery invoices and bills. Extract ALL numbers from this document. Return ONLY valid JSON no markdown: {"product_name":"","metal":"","purity":"","jewellery_type":"","gold_weight":"","stones":[{"stone_type":"","weight":"","weight_unit":"carat or gram","website_rate_per_unit":"","website_stone_value":""}],"gold_rate_per_gram":"","website_gold_value":"","website_stone_value":"","website_making_charge":"","website_gst":"","website_total":"","invoice_date":"","shop_name":"","invoice_number":"","ai_notes":""}. Rules: Read every number in the bill. gold_weight in grams. Extract each stone weight and rate. website_total is the grand total. JSON only.';
    var response = await openai.chat.completions.create({
      model: 'gpt-4.1-mini',
      max_tokens: 1200,
      temperature: 0,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: [
          { type: 'image_url', image_url: { url: 'data:image/jpeg;base64,' + b64 } },
          { type: 'text', text: 'Read this jewellery bill/invoice/price tag and extract all pricing information.' },
        ]},
      ],
    });

    var raw = response.choices[0].message.content || '';
    var ai;
    try { ai = JSON.parse(raw.replace(/```json|```/gi, '').trim()); }
    catch(e) { return res.status(500).json({ success: false, error: 'Could not read the invoice. Please ensure the image is clear and well-lit.' }); }

    var rates   = getRates();
    var pricing = calculateSaheehisabPrice(ai, rates);

    var data = Object.assign({
      product_name  : ai.product_name   || 'Invoice Product',
      metal         : ai.metal          || 'Gold',
      purity        : ai.purity         || '22K',
      jewellery_type: pricing.jewellery_label,
      jewellery_key : pricing.jewellery_key,
      gold_weight   : ai.gold_weight    || '0',
      stones        : ai.stones         || [],
      ai_notes      : ai.ai_notes       || '',
      invoice_date  : ai.invoice_date   || '',
      shop_name     : ai.shop_name      || '',
      invoice_number: ai.invoice_number || '',
      source        : 'invoice',
    }, pricing);

    // ── Capture lead ──────────────────────────────────────────────────────────
    saveLead({
      type             : 'invoice',
      source_url       : 'invoice-upload',
      product_name     : data.product_name,
      jewellery_type   : data.jewellery_type,
      metal            : data.metal,
      purity           : data.purity,
      gold_weight      : data.gold_weight,
      website_price    : data.website_price,
      saheehisab_price : data.saheehisab_price,
      estimated_savings: data.estimated_savings,
      shop_name        : data.shop_name || '',
      invoice_number   : data.invoice_number || '',
      stones           : (data.stone_breakdown || []).map(function(s) { return s.stone_type + ' ' + s.weight + (s.weight_unit || 'ct'); }).join(', '),
      client           : getClientInfo(req),
    });

    return res.json({
      success : true,
      image   : 'data:image/jpeg;base64,' + b64,
      data    : data,
    });
  } catch (err) {
    console.error('[/analyse-invoice]', err.message);
    return res.status(500).json({ success: false, error: err.message });
  } finally {
    try { fs.unlinkSync(filePath); } catch(e) {}
  }
});


// ── Leads API Routes ──────────────────────────────────────────────────────────

// GET all leads
app.get('/leads', function(req, res) {
  var leads = loadLeads();
  var page  = parseInt(req.query.page)  || 1;
  var limit = parseInt(req.query.limit) || 50;
  var type  = req.query.type || '';
  var search = (req.query.search || '').toLowerCase();

  if (type)   leads = leads.filter(function(l) { return l.type === type; });
  if (search) leads = leads.filter(function(l) {
    return (l.product_name||'').toLowerCase().indexOf(search) !== -1 ||
           (l.source_url||'').toLowerCase().indexOf(search) !== -1 ||
           (l.client && l.client.ip && l.client.ip.indexOf(search) !== -1);
  });

  var total  = leads.length;
  var start  = (page - 1) * limit;
  var paged  = leads.slice(start, start + limit);

  // Stats
  var totalSavings = leads.reduce(function(s, l) { return s + (parseFloat(l.estimated_savings) || 0); }, 0);
  var byType = {};
  leads.forEach(function(l) { byType[l.type] = (byType[l.type] || 0) + 1; });

  res.json({ success: true, total: total, page: page, pages: Math.ceil(total / limit), leads: paged, stats: { total: total, total_savings_shown: totalSavings.toFixed(2), by_type: byType } });
});

// DELETE a lead
app.delete('/leads/:id', function(req, res) {
  var leads   = loadLeads();
  var updated = leads.filter(function(l) { return l.id !== req.params.id; });
  fs.writeFileSync(LEADS_FILE, JSON.stringify(updated, null, 2));
  res.json({ success: true });
});

// DELETE all leads
app.delete('/leads', function(req, res) {
  fs.writeFileSync(LEADS_FILE, '[]');
  res.json({ success: true });
});

// POST submit enquiry (customer fills contact form after seeing result)
app.post('/enquiry', function(req, res) {
  var body = req.body;
  if (!body.name || !body.phone) {
    return res.status(400).json({ success: false, error: 'Name and phone are required.' });
  }
  var lead = saveLead({
    type          : 'enquiry',
    name          : body.name,
    phone         : body.phone,
    email         : body.email || '',
    message       : body.message || '',
    source_url    : body.source_url || '',
    product_name  : body.product_name || '',
    website_price : body.website_price || '',
    saheehisab_price: body.saheehisab_price || '',
    estimated_savings: body.estimated_savings || '',
    client        : getClientInfo(req),
  });
  res.json({ success: true, lead_id: lead.id });
});





// ══════════════════════════════════════════════════════════════════════════════
// CUSTOMER AUTH & PROFILE ROUTES
// ══════════════════════════════════════════════════════════════════════════════

var CUSTOMERS_FILE = path.join(__dirname, 'customers.json');

function loadCustomers() {
  try { return fs.existsSync(CUSTOMERS_FILE) ? JSON.parse(fs.readFileSync(CUSTOMERS_FILE, 'utf8')) : []; }
  catch(e) { return []; }
}

function saveCustomers(data) { fs.writeFileSync(CUSTOMERS_FILE, JSON.stringify(data, null, 2)); }

function findCustomer(phone) {
  return loadCustomers().find(function(c) { return c.phone === phone; }) || null;
}

function updateCustomer(customer) {
  var list = loadCustomers();
  var idx  = list.findIndex(function(c) { return c.phone === customer.phone; });
  if (idx >= 0) list[idx] = customer;
  else list.push(customer);
  saveCustomers(list);
}

// POST /customer/send-otp
app.post('/customer/send-otp', function(req, res) {
  var phone = (req.body.phone || '').trim();
  if (!phone || phone.length < 10) return res.status(400).json({ success: false, error: 'Valid phone number required' });
  var otp = Math.floor(100000 + Math.random() * 900000).toString();
  OTP_STORE[phone] = { otp: otp, expires: Date.now() + 10 * 60 * 1000 };
  console.log('[CUSTOMER OTP] ' + phone + ' -> ' + otp);
  res.json({ success: true, demo_otp: otp, message: 'OTP sent to ' + phone });
});

// POST /customer/register
app.post('/customer/register', function(req, res) {
  var body  = req.body;
  var phone = (body.phone || '').trim();
  var name  = (body.name  || '').trim();
  var email = (body.email || '').trim();
  if (!phone || !name) return res.status(400).json({ success: false, error: 'Name and phone required' });

  var existing = findCustomer(phone);
  if (existing) return res.status(400).json({ success: false, error: 'Account already exists. Please sign in.' });

  var otp = Math.floor(100000 + Math.random() * 900000).toString();
  OTP_STORE[phone] = {
    otp: otp, expires: Date.now() + 10 * 60 * 1000,
    pending: { name: name, phone: phone, email: email, city: body.city || '', referral: body.referral || '' }
  };
  console.log('[CUSTOMER REG OTP] ' + phone + ' -> ' + otp);
  res.json({ success: true, demo_otp: otp });
});

// POST /customer/verify-otp
app.post('/customer/verify-otp', function(req, res) {
  var phone = (req.body.phone || '').trim();
  var otp   = (req.body.otp   || '').trim();
  var stored = OTP_STORE[phone];

  if (!stored) return res.status(400).json({ success: false, error: 'OTP expired. Request a new one.' });
  if (Date.now() > stored.expires) { delete OTP_STORE[phone]; return res.status(400).json({ success: false, error: 'OTP expired.' }); }
  if (stored.otp !== otp) return res.status(400).json({ success: false, error: 'Incorrect OTP.' });
  delete OTP_STORE[phone];

  var customer = findCustomer(phone);

  if (!customer && stored.pending) {
    customer = {
      phone        : phone,
      name         : stored.pending.name,
      email        : stored.pending.email || '',
      city         : stored.pending.city  || '',
      referral_used: stored.pending.referral || '',
      gold_grams   : 0,
      total_invested: 0,
      member_since : new Date().toISOString(),
      last_login   : new Date().toISOString(),
      analyses_count: 0,
      savings_shown : 0,
      enquiries     : [],
      alerts        : [],
    };
    updateCustomer(customer);
    saveLead({ type: 'customer_signup', name: customer.name, phone: phone, city: customer.city, client: getClientInfo(req) });
  }

  if (!customer) return res.status(404).json({ success: false, error: 'Account not found. Please register.' });

  // Generate session token
  var crypto = require('crypto');
  var sessionToken = crypto.randomBytes(32).toString('hex');
  customer.last_login    = new Date().toISOString();
  customer.session_token = sessionToken;
  updateCustomer(customer);

  // Set cookie
  res.setHeader('Set-Cookie', 'sh_token=' + sessionToken + '; Path=/; Max-Age=2592000; SameSite=Lax');
  res.json({ success: true, customer: customer, token: sessionToken });
});

// POST /customer/logout
app.post('/customer/logout', function(req, res) {
  var token = req.body.token || (req.cookies && req.cookies['sh_token']);
  if (token) {
    var customers = loadCustomers();
    var idx = customers.findIndex(function(c) { return c.session_token === token; });
    if (idx >= 0) { customers[idx].session_token = null; saveCustomers(customers); }
  }
  res.setHeader('Set-Cookie', 'sh_token=; Path=/; Max-Age=0');
  res.json({ success: true });
});

// GET /customer/profile
app.get('/customer/profile', function(req, res) {
  var phone    = req.query.phone;
  var customer = findCustomer(phone);
  if (!customer) return res.status(404).json({ success: false, error: 'Customer not found' });
  res.json({ success: true, customer: customer });
});

// PUT /customer/profile — update profile
app.put('/customer/profile', function(req, res) {
  var phone    = req.body.phone;
  var customer = findCustomer(phone);
  if (!customer) return res.status(404).json({ success: false, error: 'Customer not found' });
  customer.name    = req.body.name    || customer.name;
  customer.email   = req.body.email   || customer.email;
  customer.city    = req.body.city    || customer.city;
  customer.dob     = req.body.dob     || customer.dob;
  customer.anniversary = req.body.anniversary || customer.anniversary;
  updateCustomer(customer);
  res.json({ success: true, customer: customer });
});

// GET /customer/history — analysis history
app.get('/customer/history', function(req, res) {
  var phone = req.query.phone;
  var leads = loadLeads().filter(function(l) {
    return l.phone === phone || l.customer_phone === phone;
  }).slice(0, 30);
  res.json({ success: true, history: leads });
});

// POST /customer/set-alert
app.post('/customer/set-alert', function(req, res) {
  var phone    = req.body.phone;
  var customer = findCustomer(phone);
  if (!customer) return res.status(404).json({ success: false, error: 'Not found' });
  customer.alerts = customer.alerts || [];
  customer.alerts.unshift({
    id        : Date.now().toString(),
    type      : req.body.alert_type || 'price',
    target    : req.body.target,
    created_at: new Date().toISOString(),
    active    : true,
  });
  updateCustomer(customer);
  res.json({ success: true });
});

// GET /admin/customers — full customer data with leads, gold, schemes
app.get('/admin/customers', function(req, res) {
  var customers = loadCustomers();
  var leads     = loadLeads ? loadLeads() : [];
  var goldUsers = loadGoldDB ? loadGoldDB() : [];
  var schemes   = loadSchemesDB ? loadSchemesDB() : [];

  // Enrich each customer with their full activity
  var enriched = customers.map(function(c) {
    // Get all their leads/analyses
    var custLeads = leads.filter(function(l) {
      return l.phone === c.phone || l.customer_phone === c.phone;
    });

    // Get gold account
    var goldAcc = goldUsers.find(function(g) { return g.phone === c.phone; });

    // Get saving schemes
    var custSchemes = schemes.filter(function(s) { return s.phone === c.phone; });

    // Calculate stats
    var totalSavings   = custLeads.reduce(function(sum, l) { return sum + (parseFloat(l.estimated_savings)||0); }, 0);
    var analysesCount  = custLeads.filter(function(l) { return ['url','image','invoice'].indexOf(l.type) !== -1; }).length;
    var enquiryCount   = custLeads.filter(function(l) { return l.type === 'enquiry'; }).length;

    return Object.assign({}, c, {
      analyses_count  : analysesCount,
      savings_shown   : totalSavings,
      enquiries_count : enquiryCount,
      gold_grams      : goldAcc ? goldAcc.gold_grams      : (c.gold_grams || 0),
      total_invested  : goldAcc ? goldAcc.total_invested  : 0,
      gold_transactions: goldAcc ? (goldAcc.transactions||[]).slice(0,5) : [],
      active_schemes  : custSchemes.filter(function(s){ return s.status === 'active'; }).length,
      total_schemes   : custSchemes.length,
      scheme_total_paid: custSchemes.reduce(function(sum, s) {
        return sum + (s.paid_months||0) * (s.monthly_amount||0);
      }, 0),
      recent_analyses : custLeads.slice(0, 10).map(function(l) {
        return {
          date        : l.timestamp,
          type        : l.type,
          product     : l.product_name || l.item || '',
          source_url  : l.source_url   || '',
          image_url   : l.image_url    || '',
          store_price : l.website_price|| l.store_price || '',
          our_price   : l.saheehisab_price || '',
          savings     : l.estimated_savings || '',
          store_name  : l.store_name   || '',
        };
      }),
    });
  });

  res.json({ success: true, total: enriched.length, customers: enriched });
});

// ══════════════════════════════════════════════════════════════════════════════
// OLD GOLD EXCHANGE CALCULATOR ROUTES
// ══════════════════════════════════════════════════════════════════════════════

// POST /exchange/calculate — server-side calculation + save lead
app.post('/exchange/calculate', function(req, res) {
  var body       = req.body;
  var rates      = getRates();

  var purity     = body.purity     || '22K';
  var weight     = parseFloat(body.weight)      || 0;
  var storeOffer = parseFloat(body.store_offer)  || 0;
  var itemType   = body.item_type  || 'jewellery';

  if (weight <= 0) return res.status(400).json({ success: false, error: 'Weight required' });

  // Get correct gold rate
  var goldRate = purity === '24K' ? rates.gold_24k :
                 purity === '22K' ? rates.gold_22k :
                 purity === '18K' ? rates.gold_18k :
                 purity === '14K' ? rates.gold_14k : rates.gold_22k;

  // Melt value = pure market value of gold content
  var meltValue = weight * goldRate;

  // Fair exchange = 95% of melt (industry standard, 5% for melting/refining cost)
  var fairExchange = meltValue * 0.95;

  // Minimum acceptable = 90% of melt
  var minimumAcceptable = meltValue * 0.90;

  // Store offer analysis
  var storeOfferPct    = storeOffer > 0 ? ((storeOffer / meltValue) * 100) : 0;
  var lossVsFair       = storeOffer > 0 ? fairExchange - storeOffer : 0;
  var lossVsMelt       = storeOffer > 0 ? meltValue - storeOffer : 0;

  // Verdict
  var verdict, verdictClass;
  if (!storeOffer) {
    verdict = 'enter_offer';
    verdictClass = 'neutral';
  } else if (storeOfferPct >= 95) {
    verdict = 'excellent';
    verdictClass = 'green';
  } else if (storeOfferPct >= 90) {
    verdict = 'fair';
    verdictClass = 'ok';
  } else if (storeOfferPct >= 80) {
    verdict = 'low';
    verdictClass = 'warn';
  } else {
    verdict = 'bad';
    verdictClass = 'red';
  }

  // Saheehisab exchange offer (we offer 93% of melt)
  var saheehisabOffer = meltValue * 0.93;

  var result = {
    purity          : purity,
    weight          : weight,
    gold_rate       : goldRate,
    melt_value      : meltValue.toFixed(2),
    fair_exchange   : fairExchange.toFixed(2),
    minimum_acceptable: minimumAcceptable.toFixed(2),
    saheehisab_offer: saheehisabOffer.toFixed(2),
    store_offer     : storeOffer.toFixed(2),
    store_offer_pct : storeOfferPct.toFixed(1),
    loss_vs_fair    : lossVsFair.toFixed(2),
    loss_vs_melt    : lossVsMelt.toFixed(2),
    verdict         : verdict,
    verdict_class   : verdictClass,
  };

  // Save lead
  if (storeOffer > 0) {
    saveLead({
      type              : 'exchange_calc',
      name              : body.customer_name  || '',
      phone             : body.customer_phone || '',
      item_type         : itemType,
      purity            : purity,
      gold_weight       : weight,
      store_name        : body.store_name     || '',
      store_offer       : storeOffer,
      melt_value        : meltValue.toFixed(2),
      fair_exchange     : fairExchange.toFixed(2),
      saheehisab_offer  : saheehisabOffer.toFixed(2),
      loss_vs_fair      : lossVsFair.toFixed(2),
      verdict           : verdict,
      client            : getClientInfo(req),
    });
  }

  res.json({ success: true, result: result });
});

// ══════════════════════════════════════════════════════════════════════════════
// PRODUCT CATALOGUE ROUTES
// ══════════════════════════════════════════════════════════════════════════════

var CATALOGUE_DB  = path.join(__dirname, 'catalogue.json');
var CAT_IMG_DIR   = path.join(__dirname, 'public', 'catalogue-images');
if (!fs.existsSync(CAT_IMG_DIR)) fs.mkdirSync(CAT_IMG_DIR, { recursive: true });

var catImgUpload = multer({
  storage: multer.diskStorage({
    destination: function(req, file, cb) { cb(null, CAT_IMG_DIR); },
    filename   : function(req, file, cb) { cb(null, Date.now() + '-' + Math.round(Math.random()*1e6) + path.extname(file.originalname)); },
  }),
  limits    : { fileSize: 8 * 1024 * 1024 },
  fileFilter: function(req, file, cb) {
    if (['image/jpeg','image/png','image/webp'].includes(file.mimetype)) return cb(null, true);
    cb(new Error('Only JPEG/PNG/WEBP allowed'));
  },
});

function loadCatalogue() {
  try { return fs.existsSync(CATALOGUE_DB) ? JSON.parse(fs.readFileSync(CATALOGUE_DB, 'utf8')) : []; }
  catch(e) { return []; }
}
function saveCatalogue(data) { fs.writeFileSync(CATALOGUE_DB, JSON.stringify(data, null, 2)); }

// GET all catalogue products (public — auth checked on frontend)
app.get('/catalogue', function(req, res) {
  var items    = loadCatalogue();
  var type     = req.query.type || '';
  var search   = (req.query.search || '').toLowerCase();
  var filtered = items.filter(function(p) { return p.active !== false; });
  if (type)   filtered = filtered.filter(function(p) { return p.jewellery_type === type; });
  if (search) filtered = filtered.filter(function(p) {
    return (p.name||'').toLowerCase().indexOf(search) !== -1 ||
           (p.description||'').toLowerCase().indexOf(search) !== -1;
  });
  res.json({ success: true, products: filtered });
});

// GET single product
app.get('/catalogue/:id', function(req, res) {
  var items = loadCatalogue();
  var p     = items.find(function(x) { return x.id === req.params.id; });
  if (!p) return res.status(404).json({ success: false, error: 'Not found' });
  res.json({ success: true, product: p });
});

// POST add product (admin)
app.post('/catalogue', catImgUpload.array('images', 6), function(req, res) {
  var body    = req.body;
  var items   = loadCatalogue();
  var imgUrls = (req.files || []).map(function(f) { return '/catalogue-images/' + f.filename; });

  var product = {
    id             : generateId('PRD'),
    name           : body.name           || '',
    jewellery_type : body.jewellery_type || 'plain',
    metal          : body.metal          || 'Gold',
    purity         : body.purity         || '22K',
    making_percent : parseFloat(body.making_percent) || 8,
    typical_weight_min: parseFloat(body.weight_min) || 0,
    typical_weight_max: parseFloat(body.weight_max) || 0,
    stones         : body.stones         || '',
    description    : body.description    || '',
    images         : imgUrls,
    tags           : (body.tags || '').split(',').map(function(t){ return t.trim(); }).filter(Boolean),
    active         : true,
    created_at     : new Date().toISOString(),
  };

  items.unshift(product);
  saveCatalogue(items);
  res.json({ success: true, product: product });
});

// PUT update product (admin)
app.put('/catalogue/:id', catImgUpload.array('images', 6), function(req, res) {
  var items = loadCatalogue();
  var idx   = items.findIndex(function(x) { return x.id === req.params.id; });
  if (idx < 0) return res.status(404).json({ success: false, error: 'Not found' });

  var body    = req.body;
  var newImgs = (req.files || []).map(function(f) { return '/catalogue-images/' + f.filename; });
  var keepOld = body.keep_images ? JSON.parse(body.keep_images) : items[idx].images;

  items[idx] = Object.assign(items[idx], {
    name           : body.name           || items[idx].name,
    jewellery_type : body.jewellery_type || items[idx].jewellery_type,
    metal          : body.metal          || items[idx].metal,
    purity         : body.purity         || items[idx].purity,
    making_percent : parseFloat(body.making_percent) || items[idx].making_percent,
    typical_weight_min: parseFloat(body.weight_min) || items[idx].typical_weight_min,
    typical_weight_max: parseFloat(body.weight_max) || items[idx].typical_weight_max,
    stones         : body.stones !== undefined ? body.stones : items[idx].stones,
    description    : body.description    || items[idx].description,
    images         : keepOld.concat(newImgs),
    tags           : body.tags ? body.tags.split(',').map(function(t){ return t.trim(); }).filter(Boolean) : items[idx].tags,
    active         : body.active !== undefined ? (body.active === 'true' || body.active === true) : items[idx].active,
    updated_at     : new Date().toISOString(),
  });

  saveCatalogue(items);
  res.json({ success: true, product: items[idx] });
});

// DELETE product (admin)
app.delete('/catalogue/:id', function(req, res) {
  var items   = loadCatalogue();
  var updated = items.filter(function(x) { return x.id !== req.params.id; });
  saveCatalogue(updated);
  res.json({ success: true });
});

// POST submit store estimate (send to WhatsApp)
app.post('/catalogue/estimate/submit', function(req, res) {
  var body = req.body;
  saveLead({
    type            : 'catalogue_estimate',
    name            : body.customer_name   || '',
    phone           : body.customer_phone  || '',
    store_name      : body.store_name      || '',
    product_name    : body.product_name    || '',
    jewellery_type  : body.jewellery_type  || '',
    purity          : body.purity          || '',
    gold_weight     : body.gold_weight     || '',
    stones          : body.stones          || '',
    store_price     : body.store_price     || '',
    saheehisab_price: body.saheehisab_price|| '',
    estimated_savings: body.estimated_savings || '',
    notes           : body.notes           || '',
    client          : getClientInfo(req),
  });
  res.json({ success: true });
});

// Serve catalogue images statically
app.use('/catalogue-images', express.static(CAT_IMG_DIR));

// ══════════════════════════════════════════════════════════════════════════════
// DIGITAL GOLD & SAVING SCHEME ROUTES
// ══════════════════════════════════════════════════════════════════════════════

var GOLD_DB_FILE    = path.join(__dirname, 'gold_users.json');
var SCHEMES_DB_FILE = path.join(__dirname, 'gold_schemes.json');
var OTP_STORE       = {};  // In-memory OTP store { phone: { otp, expires } }

function loadGoldDB()    { try { return fs.existsSync(GOLD_DB_FILE)    ? JSON.parse(fs.readFileSync(GOLD_DB_FILE,    'utf8')) : []; } catch(e) { return []; } }
function saveGoldDB(d)   { fs.writeFileSync(GOLD_DB_FILE,    JSON.stringify(d, null, 2)); }
function loadSchemesDB() { try { return fs.existsSync(SCHEMES_DB_FILE) ? JSON.parse(fs.readFileSync(SCHEMES_DB_FILE, 'utf8')) : []; } catch(e) { return []; } }
function saveSchemesDB(d){ fs.writeFileSync(SCHEMES_DB_FILE, JSON.stringify(d, null, 2)); }

function findUser(phone) {
  var users = loadGoldDB();
  return users.find(function(u) { return u.phone === phone; }) || null;
}

function updateUser(user) {
  var users   = loadGoldDB();
  var idx     = users.findIndex(function(u) { return u.phone === user.phone; });
  if (idx >= 0) users[idx] = user;
  else users.push(user);
  saveGoldDB(users);
}

function generateReferralCode(name) {
  var base = (name || 'USER').replace(/[^A-Z]/gi, '').toUpperCase().slice(0, 4);
  return base + Math.floor(1000 + Math.random() * 9000);
}

function generateId(prefix) {
  return prefix + Date.now().toString(36).toUpperCase() + Math.random().toString(36).slice(2, 5).toUpperCase();
}

// ── Send OTP ──────────────────────────────────────────────────────────────────
app.post('/gold/send-otp', function(req, res) {
  var phone = (req.body.phone || '').trim();
  if (!phone || phone.length < 10) return res.status(400).json({ success: false, error: 'Valid phone required' });
  var otp = Math.floor(100000 + Math.random() * 900000).toString();
  OTP_STORE[phone] = { otp: otp, expires: Date.now() + 10 * 60 * 1000 };
  console.log('[OTP] ' + phone + ' -> ' + otp);
  // In production: send via SMS/WhatsApp API here
  res.json({ success: true, demo_otp: otp, message: 'OTP sent to ' + phone });
});

// ── Register ──────────────────────────────────────────────────────────────────
app.post('/gold/register', function(req, res) {
  var body  = req.body;
  var phone = (body.phone || '').trim();
  var name  = (body.name  || '').trim();
  if (!phone || !name) return res.status(400).json({ success: false, error: 'Name and phone required' });

  var existing = findUser(phone);
  if (existing) return res.status(400).json({ success: false, error: 'Account already exists. Please sign in.' });

  var otp = Math.floor(100000 + Math.random() * 900000).toString();
  OTP_STORE[phone] = { otp: otp, expires: Date.now() + 10 * 60 * 1000, pending: { name: name, phone: phone, email: body.email || '', referral_code_used: body.referral_code || '' } };
  console.log('[OTP-REG] ' + phone + ' -> ' + otp);
  res.json({ success: true, demo_otp: otp, message: 'OTP sent' });
});

// ── Verify OTP ────────────────────────────────────────────────────────────────
app.post('/gold/verify-otp', function(req, res) {
  var phone = (req.body.phone || '').trim();
  var otp   = (req.body.otp   || '').trim();
  var stored = OTP_STORE[phone];

  if (!stored) return res.status(400).json({ success: false, error: 'OTP expired or not sent. Request a new one.' });
  if (Date.now() > stored.expires) { delete OTP_STORE[phone]; return res.status(400).json({ success: false, error: 'OTP expired. Request a new one.' }); }
  if (stored.otp !== otp) return res.status(400).json({ success: false, error: 'Incorrect OTP. Please try again.' });

  delete OTP_STORE[phone];

  // Find or create user
  var user = findUser(phone);
  if (!user && stored.pending) {
    var rates = getRates();
    user = {
      phone          : phone,
      name           : stored.pending.name,
      email          : stored.pending.email,
      gold_grams     : 0,
      total_invested : 0,
      transactions   : [],
      referral_code  : generateReferralCode(stored.pending.name),
      referral_code_used: stored.pending.referral_code_used,
      price_alert_low : 0,
      price_alert_high: 0,
      created_at     : new Date().toISOString(),
    };
    // Give ₹500 referral bonus if valid code used
    if (user.referral_code_used) {
      var referrer = loadGoldDB().find(function(u) { return u.referral_code === user.referral_code_used; });
      if (referrer) {
        var bonusGrams = 500 / (rates.gold_24k || 9850);
        referrer.gold_grams     = parseFloat(referrer.gold_grams || 0) + bonusGrams;
        referrer.total_invested = parseFloat(referrer.total_invested || 0);
        referrer.transactions   = referrer.transactions || [];
        referrer.transactions.unshift({ type: 'reward', grams: bonusGrams, amount: 500, rate: rates.gold_24k, timestamp: new Date().toISOString(), notes: 'Referral bonus: ' + user.name + ' joined' });
        updateUser(referrer);
        user.gold_grams += bonusGrams;
        user.transactions = [{ type: 'reward', grams: bonusGrams, amount: 500, rate: rates.gold_24k, timestamp: new Date().toISOString(), notes: 'Welcome bonus (referral code used)' }];
      }
    }
    updateUser(user);
    saveLead({ type: 'gold_signup', name: user.name, phone: phone, referral_used: user.referral_code_used, client: getClientInfo(req) });
  }

  if (!user) return res.status(400).json({ success: false, error: 'Account not found. Please register.' });
  res.json({ success: true, user: user });
});

// ── Get Profile ───────────────────────────────────────────────────────────────
app.get('/gold/profile', function(req, res) {
  var phone = req.query.phone;
  var user  = findUser(phone);
  if (!user) return res.status(404).json({ success: false, error: 'User not found' });
  res.json({ success: true, user: user });
});

// ── Get Transactions ──────────────────────────────────────────────────────────
app.get('/gold/transactions', function(req, res) {
  var phone = req.query.phone;
  var user  = findUser(phone);
  if (!user) return res.status(404).json({ success: false, error: 'User not found' });
  res.json({ success: true, transactions: (user.transactions || []).slice(0, 50) });
});

// ── Buy Gold ──────────────────────────────────────────────────────────────────
app.post('/gold/buy', function(req, res) {
  var phone   = req.body.phone;
  var amount  = parseFloat(req.body.amount) || 0;
  var user    = findUser(phone);
  if (!user)   return res.status(404).json({ success: false, error: 'User not found' });
  if (amount < 1) return res.status(400).json({ success: false, error: 'Minimum ₹1 required' });

  var rates  = getRates();
  var rate   = rates.gold_24k || 9850;
  var grams  = amount / rate;

  user.gold_grams     = parseFloat(user.gold_grams || 0) + grams;
  user.total_invested = parseFloat(user.total_invested || 0) + amount;
  user.transactions   = user.transactions || [];
  user.transactions.unshift({ type: 'buy', grams: grams, amount: amount, rate: rate, timestamp: new Date().toISOString(), notes: req.body.payment || 'Purchase', payment_method: req.body.payment });

  updateUser(user);
  saveLead({ type: 'gold_buy', phone: phone, name: user.name, amount: amount, grams: grams.toFixed(4), client: getClientInfo(req) });
  res.json({ success: true, user: user, grams: grams.toFixed(4), amount: amount });
});

// ── Sell Gold ─────────────────────────────────────────────────────────────────
app.post('/gold/sell', function(req, res) {
  var phone  = req.body.phone;
  var grams  = parseFloat(req.body.grams) || 0;
  var user   = findUser(phone);
  if (!user)  return res.status(404).json({ success: false, error: 'User not found' });
  if (grams <= 0) return res.status(400).json({ success: false, error: 'Invalid grams' });
  if (grams > parseFloat(user.gold_grams || 0)) return res.status(400).json({ success: false, error: 'Insufficient gold balance' });

  var rates  = getRates();
  var rate   = rates.gold_24k || 9850;
  var amount = grams * rate * 0.99; // 1% processing fee

  user.gold_grams   = parseFloat(user.gold_grams) - grams;
  user.transactions = user.transactions || [];
  user.transactions.unshift({ type: 'sell', grams: grams, amount: amount, rate: rate, timestamp: new Date().toISOString(), notes: 'Bank: ' + (req.body.bank_details || '—') });

  updateUser(user);
  saveLead({ type: 'gold_sell', phone: phone, name: user.name, grams: grams, amount: Math.round(amount), client: getClientInfo(req) });
  res.json({ success: true, user: user, amount: amount });
});

// ── Redeem ────────────────────────────────────────────────────────────────────
app.post('/gold/redeem', function(req, res) {
  var phone  = req.body.phone;
  var grams  = parseFloat(req.body.grams) || 0;
  var user   = findUser(phone);
  if (!user)  return res.status(404).json({ success: false, error: 'User not found' });
  if (grams <= 0) return res.status(400).json({ success: false, error: 'Invalid grams' });
  if (grams > parseFloat(user.gold_grams || 0)) return res.status(400).json({ success: false, error: 'Insufficient gold balance' });

  var rates        = getRates();
  var goldValue    = grams * (rates.gold_22k || 9150);
  var normalMaking = goldValue * 0.10;
  var ourMaking    = normalMaking * 0.50;
  var saving       = normalMaking - ourMaking;

  user.gold_grams   = parseFloat(user.gold_grams) - grams;
  user.transactions = user.transactions || [];
  user.transactions.unshift({ type: 'redeem', grams: grams, amount: goldValue, rate: rates.gold_22k, timestamp: new Date().toISOString(), notes: (req.body.type || 'jewellery') + ' · making saved ₹' + Math.round(saving) });

  updateUser(user);
  saveLead({ type: 'gold_redeem', phone: phone, name: user.name, grams: grams, item_type: req.body.type, address: req.body.address, saving: Math.round(saving), client: getClientInfo(req) });
  res.json({ success: true, user: user, gold_value: goldValue, normal_making: normalMaking, our_making: ourMaking, saving: saving });
});

// ── Set Price Alert ───────────────────────────────────────────────────────────
app.post('/gold/set-alert', function(req, res) {
  var phone = req.body.phone;
  var user  = findUser(phone);
  if (!user) return res.status(404).json({ success: false, error: 'User not found' });
  user.price_alert_low  = parseFloat(req.body.alert_low)  || 0;
  user.price_alert_high = parseFloat(req.body.alert_high) || 0;
  user.alert_whatsapp   = req.body.whatsapp || phone;
  updateUser(user);
  res.json({ success: true });
});

// ── Locker Appointment ────────────────────────────────────────────────────────
app.post('/gold/locker-appointment', function(req, res) {
  saveLead({ type: 'gold_locker', phone: req.body.phone, appointment_date: req.body.appointment_date, estimated_grams: req.body.estimated_grams, contact: req.body.contact, client: getClientInfo(req) });
  res.json({ success: true, message: 'Appointment booked' });
});

// ── EMI Booking ───────────────────────────────────────────────────────────────
app.post('/gold/emi-booking', function(req, res) {
  var bookingId = generateId('EMI');
  saveLead({ type: 'gold_emi', phone: req.body.phone, item: req.body.item, total_amount: req.body.total_amount, months: req.body.months, booking_id: bookingId, client: getClientInfo(req) });
  res.json({ success: true, booking_id: bookingId });
});

// ── Join Saving Scheme ────────────────────────────────────────────────────────
app.post('/gold/scheme-join', function(req, res) {
  var body    = req.body;
  var phone   = (body.phone || '').trim();
  var name    = (body.name  || '').trim();
  var amount  = parseFloat(body.monthly_amount) || 0;
  if (!phone || !name || amount < 100) return res.status(400).json({ success: false, error: 'Name, phone, and minimum ₹100 monthly amount required' });

  var schemes   = loadSchemesDB();
  var schemeId  = generateId('SCH');
  var startDate = new Date().toISOString();
  var payday    = parseInt(body.payment_day) || 1;
  var nextDue   = new Date(); nextDue.setDate(payday); if (nextDue <= new Date()) nextDue.setMonth(nextDue.getMonth() + 1);

  var scheme = {
    scheme_id       : schemeId,
    phone           : phone,
    name            : name,
    email           : body.email || '',
    monthly_amount  : amount,
    duration_months : parseInt(body.duration_months) || 12,
    payment_day     : payday,
    paid_months     : 0,
    start_date      : startDate,
    next_due        : nextDue.toISOString(),
    nominee_name    : body.nominee_name || '',
    nominee_relation: body.nominee_relation || '',
    referral_code   : body.referral_code || '',
    status          : 'active',
    payments        : [],
  };

  schemes.push(scheme);
  saveSchemesDB(schemes);
  saveLead({ type: 'scheme_join', name: name, phone: phone, monthly_amount: amount, scheme_id: schemeId, client: getClientInfo(req) });
  res.json({ success: true, scheme_id: schemeId, first_due: nextDue.toLocaleDateString('en-IN') });
});

// ── Get My Schemes ────────────────────────────────────────────────────────────
app.get('/gold/my-schemes', function(req, res) {
  var phone   = req.query.phone;
  var schemes = loadSchemesDB().filter(function(s) { return s.phone === phone; });
  res.json({ success: true, schemes: schemes });
});

// ── Pay Scheme Instalment ─────────────────────────────────────────────────────
app.post('/gold/scheme-pay', function(req, res) {
  var schemeId = req.body.scheme_id;
  var phone    = req.body.phone;
  var amount   = parseFloat(req.body.amount) || 0;
  var schemes  = loadSchemesDB();
  var idx      = schemes.findIndex(function(s) { return s.scheme_id === schemeId && s.phone === phone; });
  if (idx < 0) return res.status(404).json({ success: false, error: 'Scheme not found' });

  var scheme      = schemes[idx];
  scheme.paid_months = (scheme.paid_months || 0) + 1;
  var nextDue     = new Date(scheme.next_due || new Date());
  nextDue.setMonth(nextDue.getMonth() + 1);
  scheme.next_due = nextDue.toISOString();
  scheme.payments = scheme.payments || [];
  scheme.payments.push({ month: scheme.paid_months, amount: amount, date: new Date().toISOString() });
  if (scheme.paid_months >= scheme.duration_months - 1) { scheme.status = 'matured'; }

  schemes[idx] = scheme;
  saveSchemesDB(schemes);
  saveLead({ type: 'scheme_payment', phone: phone, scheme_id: schemeId, month: scheme.paid_months, amount: amount, client: getClientInfo(req) });
  res.json({ success: true, month_number: scheme.paid_months });
});

// ── Redeem Scheme ─────────────────────────────────────────────────────────────
app.post('/gold/scheme-redeem', function(req, res) {
  var schemeId  = req.body.scheme_id;
  var phone     = req.body.phone;
  var redeemAs  = req.body.redeem_as || 'jewellery';
  var schemes   = loadSchemesDB();
  var scheme    = schemes.find(function(s) { return s.scheme_id === schemeId && s.phone === phone; });
  if (!scheme) return res.status(404).json({ success: false, error: 'Scheme not found' });

  var rates       = getRates();
  var paidMonths  = scheme.paid_months || 0;
  var freeMonths  = Math.floor((scheme.duration_months || 12) / 12);
  var totalAmount = scheme.monthly_amount * (paidMonths + freeMonths);
  var totalValue  = totalAmount;
  var bonusAmount = scheme.monthly_amount * freeMonths;

  scheme.status      = 'redeemed';
  scheme.redeemed_as = redeemAs;
  scheme.redeemed_at = new Date().toISOString();
  var idx = schemes.findIndex(function(s) { return s.scheme_id === schemeId; });
  if (idx >= 0) schemes[idx] = scheme;
  saveSchemesDB(schemes);
  saveLead({ type: 'scheme_redeem', phone: phone, scheme_id: schemeId, redeem_as: redeemAs, total_value: totalValue, client: getClientInfo(req) });
  res.json({ success: true, total_value: totalValue, bonus_amount: bonusAmount });
});

// ── Admin: All Gold Users ─────────────────────────────────────────────────────
app.get('/gold/admin/users', function(req, res) {
  res.json({ success: true, users: loadGoldDB(), schemes: loadSchemesDB() });
});


// ── Serve saved images statically ─────────────────────────────────────────────
app.use('/saved-images', express.static(SAVED_IMGS_DIR));

// ── GET /share/:id — shareable result page ────────────────────────────────────
app.get('/share/:id', function(req, res) {
  var share = getShare(req.params.id);
  if (!share) return res.status(404).send('<h2>Share link not found or expired.</h2>');

  var fmt      = function(n) { return n && parseFloat(n) > 0 ? 'Rs.' + Math.round(parseFloat(n)).toLocaleString('en-IN') : '—'; };
  var savings  = parseFloat(share.estimated_savings) || 0;
  var savingsTxt = savings > 0 ? 'You Save Rs.' + Math.round(savings).toLocaleString('en-IN') : 'Compare Pricing';
  var imgTag   = share.image_url ? '<img src="' + share.image_url + '" style="width:100%;max-height:340px;object-fit:cover;border-radius:12px;margin-bottom:20px" />' : '';
  var baseUrl  = 'http://localhost:' + (process.env.PORT || 5050);
  var fullImg  = share.image_url ? baseUrl + share.image_url : '';

  var html = '<!DOCTYPE html><html><head>' +
    '<meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1.0"/>' +
    '<title>' + (share.product_name || 'Jewellery') + ' — Saheehisab AI</title>' +
    '<meta property="og:title" content="' + (share.product_name || 'Jewellery Price Check') + ' — Saheehisab AI" />' +
    '<meta property="og:description" content="' + savingsTxt + ' | Website: ' + fmt(share.website_price) + ' | Saheehisab: ' + fmt(share.saheehisab_price) + '" />' +
    (fullImg ? '<meta property="og:image" content="' + fullImg + '" />' : '') +
    '<meta property="og:type" content="website" />' +
    '<meta name="twitter:card" content="summary_large_image" />' +
    '<style>' +
    'body{background:#0A0A0A;color:#F5F0E8;font-family:Inter,sans-serif;margin:0;padding:20px;min-height:100vh}' +
    '.card{max-width:520px;margin:0 auto;background:#111;border:1px solid rgba(201,168,76,.25);border-radius:16px;padding:24px}' +
    '.logo{font-size:13px;color:#8B6914;margin-bottom:20px;font-weight:600;letter-spacing:.06em;text-transform:uppercase}' +
    '.product-name{font-size:22px;font-weight:600;margin-bottom:6px}' +
    '.chips{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:20px}' +
    '.chip{padding:3px 10px;border-radius:100px;font-size:11px;font-weight:600;background:rgba(201,168,76,.1);border:1px solid rgba(201,168,76,.25);color:#C9A84C}' +
    'table{width:100%;border-collapse:collapse;margin-bottom:20px}' +
    'th{padding:10px 14px;text-align:left;font-size:10px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:#A89F8C;background:#1A1A1A;border-bottom:1px solid rgba(201,168,76,.1)}' +
    'td{padding:10px 14px;font-size:14px;border-bottom:1px solid rgba(255,255,255,.04)}' +
    '.gold-val{color:#C9A84C;font-weight:600}' +
    '.savings-box{background:linear-gradient(135deg,#1C1608,#241E00);border:1px solid rgba(201,168,76,.3);border-radius:12px;padding:20px;text-align:center;margin-bottom:20px}' +
    '.savings-label{font-size:11px;color:#8B6914;text-transform:uppercase;letter-spacing:.1em;margin-bottom:6px}' +
    '.savings-amount{font-size:36px;font-weight:700;color:#C9A84C}' +
    '.btn-wa{display:block;width:100%;padding:14px;background:#25D366;color:#000;border:none;border-radius:10px;font-size:14px;font-weight:700;cursor:pointer;text-align:center;text-decoration:none;margin-bottom:10px}' +
    '.btn-check{display:block;width:100%;padding:12px;background:transparent;color:#C9A84C;border:1px solid rgba(201,168,76,.3);border-radius:10px;font-size:13px;font-weight:600;cursor:pointer;text-align:center;text-decoration:none}' +
    '</style></head><body>' +
    '<div class="card">' +
    '<div class="logo">◆ Saheehisab AI — Jewellery Price Check</div>' +
    imgTag +
    '<div class="product-name">' + (share.product_name || 'Jewellery') + '</div>' +
    '<div class="chips">' +
    (share.metal ? '<span class="chip">' + share.metal + '</span>' : '') +
    (share.purity ? '<span class="chip">' + share.purity + '</span>' : '') +
    (share.jewellery_type ? '<span class="chip">' + share.jewellery_type + '</span>' : '') +
    (share.gold_weight && parseFloat(share.gold_weight) > 0 ? '<span class="chip">' + share.gold_weight + 'g</span>' : '') +
    '</div>' +
    '<table><thead><tr><th>Component</th><th>Website</th><th>Saheehisab</th></tr></thead><tbody>' +
    '<tr><td style="color:#A89F8C">Total Price</td><td>' + fmt(share.website_price) + '</td><td class="gold-val">' + fmt(share.saheehisab_price) + '</td></tr>' +
    '</tbody></table>' +
    (savings > 0 ? '<div class="savings-box"><div class="savings-label">Estimated Savings</div><div class="savings-amount">Rs.' + Math.round(savings).toLocaleString('en-IN') + '</div></div>' : '') +
    '<a class="btn-wa" href="https://wa.me/919509458270?text=' + encodeURIComponent('I found this jewellery on Saheehisab AI: ' + share.product_name + '. Website price: Rs.' + fmt(share.website_price) + '. Please give me your best price.') + '" target="_blank">💬 Contact Saheehisab on WhatsApp</a>' +
    '<a class="btn-check" href="/">🔍 Check Another Product</a>' +
    '<p style="font-size:11px;color:#A89F8C;text-align:center;margin-top:16px;line-height:1.6">Saheehisab AI · A unit of Seervi Gems &amp; Jewellery Pvt. Ltd.<br/>+91 95094 58270 · Prices are estimates based on live MCX rates</p>' +
    '</div></body></html>';

  res.send(html);
});

// ── GET /share-data/:id — JSON for frontend ───────────────────────────────────
app.get('/share-data/:id', function(req, res) {
  var share = getShare(req.params.id);
  if (!share) return res.status(404).json({ success: false, error: 'Not found' });
  res.json({ success: true, share: share });
});


// ── Debug: See raw scraped text ──────────────────────────────────────────────
app.post('/debug-scrape', analysisLimiter, async function(req, res) {
  var url = req.body.url;
  if (!url) return res.status(400).json({ error: 'url required' });
  try {
    var product = await scrapeProduct(url);
    // If scraper attached direct extract (CaratLane NEXT_DATA), store on product
    if (product && product._directExtract) {
    }
    res.json({ success: true, title: product.title, image: product.image, text_preview: product.text.slice(0, 3000) });
  } catch(err) {
    res.json({ success: false, error: err.message });
  }
});


// ══════════════════════════════════════════════════════════════════════════════
// EXPORT ROUTES — Excel & PDF
// ══════════════════════════════════════════════════════════════════════════════

// GET /export/customers/excel
app.get('/export/customers/excel', async function(req, res) {
  try {
    var customers = loadCustomers();
    var leads     = loadLeads ? loadLeads() : [];
    var goldUsers = loadGoldDB ? loadGoldDB() : [];
    var schemes   = loadSchemesDB ? loadSchemesDB() : [];

    // Build enriched data
    var rows = customers.map(function(c) {
      var custLeads   = leads.filter(function(l){ return l.phone === c.phone; });
      var goldAcc     = goldUsers.find(function(g){ return g.phone === c.phone; });
      var custSchemes = schemes.filter(function(s){ return s.phone === c.phone; });
      var totalSavings = custLeads.reduce(function(sum,l){ return sum+(parseFloat(l.estimated_savings)||0); }, 0);
      return {
        name         : c.name || '',
        phone        : c.phone || '',
        email        : c.email || '',
        city         : c.city || '',
        dob          : c.dob || '',
        anniversary  : c.anniversary || '',
        member_since : c.member_since ? new Date(c.member_since).toLocaleDateString('en-IN') : '',
        last_login   : c.last_login   ? new Date(c.last_login).toLocaleDateString('en-IN')   : '',
        analyses     : custLeads.filter(function(l){ return ['url','image'].includes(l.type); }).length,
        enquiries    : custLeads.filter(function(l){ return l.type==='enquiry'; }).length,
        savings_shown: Math.round(totalSavings),
        gold_grams   : parseFloat(goldAcc ? goldAcc.gold_grams : (c.gold_grams||0)).toFixed(4),
        gold_invested: Math.round(goldAcc ? (goldAcc.total_invested||0) : 0),
        active_schemes : custSchemes.filter(function(s){ return s.status==='active'; }).length,
        scheme_paid  : custSchemes.reduce(function(sum,s){ return sum+(s.paid_months||0)*(s.monthly_amount||0); }, 0),
        referral_used: c.referral_used || '',
      };
    });

    // Generate Excel using Python
    var { execSync } = require('child_process');
    var tmpFile = path.join(__dirname, 'exports', 'customers_' + Date.now() + '.xlsx');
    
    // Ensure exports dir exists
    var exportsDir = path.join(__dirname, 'exports');
    if (!fs.existsSync(exportsDir)) fs.mkdirSync(exportsDir);

    // Write data to temp JSON
    var tmpJson = path.join(__dirname, 'exports', 'tmp_customers.json');
    fs.writeFileSync(tmpJson, JSON.stringify(rows));

    // Run Python to generate Excel
    var pyScript = `
import json, sys
from openpyxl import Workbook
from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
from openpyxl.utils import get_column_letter

with open('${tmpJson}') as f:
    rows = json.load(f)

wb = Workbook()
ws = wb.active
ws.title = 'Customers'

headers = ['Name','Phone','Email','City','DOB','Anniversary','Member Since','Last Login',
           'Analyses','Enquiries','Savings Shown (Rs)','Gold Balance (g)','Gold Invested (Rs)',
           'Active Schemes','Scheme Paid (Rs)','Referral Used']

keys = ['name','phone','email','city','dob','anniversary','member_since','last_login',
        'analyses','enquiries','savings_shown','gold_grams','gold_invested',
        'active_schemes','scheme_paid','referral_used']

# Header style
hdr_fill = PatternFill('solid', start_color='1C1608')
hdr_font = Font(bold=True, color='C9A84C', size=11)
border   = Border(bottom=Side(style='thin', color='C9A84C'))

for col, h in enumerate(headers, 1):
    cell = ws.cell(row=1, column=col, value=h)
    cell.font      = hdr_font
    cell.fill      = hdr_fill
    cell.alignment = Alignment(horizontal='center', vertical='center')
    cell.border    = border

# Data rows
for r, row in enumerate(rows, 2):
    for col, key in enumerate(keys, 1):
        cell = ws.cell(row=r, column=col, value=row.get(key,''))
        cell.alignment = Alignment(vertical='center')
        if r % 2 == 0:
            cell.fill = PatternFill('solid', start_color='111111')

# Column widths
widths = [18,14,24,12,12,12,14,14,10,10,18,14,16,14,16,14]
for i, w in enumerate(widths, 1):
    ws.column_dimensions[get_column_letter(i)].width = w

ws.row_dimensions[1].height = 22
ws.freeze_panes = 'A2'

# Summary sheet
ws2 = wb.create_sheet('Summary')
ws2['A1'] = 'Saheehisab AI - Customer Export'
ws2['A1'].font = Font(bold=True, size=14, color='C9A84C')
ws2['A3'] = 'Total Customers'
ws2['B3'] = len(rows)
ws2['A4'] = 'Total Analyses'
ws2['B4'] = sum(r.get('analyses',0) for r in rows)
ws2['A5'] = 'Total Savings Shown'
ws2['B5'] = sum(r.get('savings_shown',0) for r in rows)
ws2['A6'] = 'Total Gold (grams)'
ws2['B6'] = round(sum(float(r.get('gold_grams',0)) for r in rows), 4)
ws2['A7'] = 'Export Date'
ws2['B7'] = '${new Date().toLocaleDateString("en-IN")}'

for row in ws2['A1:B7']:
    for cell in row:
        cell.alignment = Alignment(vertical='center')

ws2.column_dimensions['A'].width = 22
ws2.column_dimensions['B'].width = 18

wb.save('${tmpFile}')
print('OK')
`;

    var result = execSync('python3 -c "' + pyScript.replace(/"/g, '\"') + '"').toString().trim();
    
    if (result !== 'OK' || !fs.existsSync(tmpFile)) {
      throw new Error('Excel generation failed');
    }

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="saheehisab-customers-' + new Date().toISOString().slice(0,10) + '.xlsx"');
    var fileBuffer = fs.readFileSync(tmpFile);
    res.send(fileBuffer);

    // Cleanup
    try { fs.unlinkSync(tmpFile); fs.unlinkSync(tmpJson); } catch(e) {}

  } catch(err) {
    console.error('[export/excel]', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /export/leads/excel
app.get('/export/leads/excel', async function(req, res) {
  try {
    var leads = loadLeads ? loadLeads() : [];
    var { execSync } = require('child_process');
    var exportsDir = path.join(__dirname, 'exports');
    if (!fs.existsSync(exportsDir)) fs.mkdirSync(exportsDir);
    var tmpFile = path.join(exportsDir, 'leads_' + Date.now() + '.xlsx');
    var tmpJson = path.join(exportsDir, 'tmp_leads.json');
    
    var rows = leads.map(function(l) {
      return {
        date        : l.timestamp ? new Date(l.timestamp).toLocaleString('en-IN') : '',
        type        : l.type || '',
        product     : l.product_name || l.item || '',
        jewellery   : l.jewellery_type || '',
        store       : l.store_name || '',
        purity      : l.purity || '',
        weight      : l.gold_weight || '',
        store_price : l.website_price || l.store_price || '',
        our_price   : l.saheehisab_price || '',
        savings     : l.estimated_savings || '',
        name        : l.name || '',
        phone       : l.phone || l.customer_phone || '',
        email       : l.email || '',
        source_url  : l.source_url || '',
        device      : l.client ? (l.client.device||'') : '',
        ip          : l.client ? (l.client.ip||'') : '',
      };
    });

    fs.writeFileSync(tmpJson, JSON.stringify(rows));

    var pyScript = `
import json
from openpyxl import Workbook
from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
from openpyxl.utils import get_column_letter

with open('${tmpJson}') as f:
    rows = json.load(f)

wb = Workbook()
ws = wb.active
ws.title = 'Leads'

headers = ['Date','Type','Product','Jewellery Type','Store','Purity','Weight(g)',
           'Store Price','Our Price','Savings','Customer Name','Phone','Email','Source URL','Device','IP']
keys = ['date','type','product','jewellery','store','purity','weight',
        'store_price','our_price','savings','name','phone','email','source_url','device','ip']

hdr_fill = PatternFill('solid', start_color='1C1608')
hdr_font = Font(bold=True, color='C9A84C', size=11)

for col, h in enumerate(headers, 1):
    cell = ws.cell(row=1, column=col, value=h)
    cell.font = hdr_font
    cell.fill = hdr_fill
    cell.alignment = Alignment(horizontal='center')

for r, row in enumerate(rows, 2):
    for col, key in enumerate(keys, 1):
        val = row.get(key,'')
        try: val = float(val) if val and key in ['store_price','our_price','savings','weight'] else val
        except: pass
        cell = ws.cell(row=r, column=col, value=val)
        if r % 2 == 0:
            cell.fill = PatternFill('solid', start_color='111111')

widths = [18,10,25,14,18,8,10,14,14,12,16,14,22,35,10,14]
for i,w in enumerate(widths,1):
    ws.column_dimensions[get_column_letter(i)].width = w

ws.freeze_panes = 'A2'
wb.save('${tmpFile}')
print('OK')
`;

    execSync('python3 -c "' + pyScript.replace(/"/g, '\"') + '"');
    
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="saheehisab-leads-' + new Date().toISOString().slice(0,10) + '.xlsx"');
    res.send(fs.readFileSync(tmpFile));
    try { fs.unlinkSync(tmpFile); fs.unlinkSync(tmpJson); } catch(e) {}

  } catch(err) {
    res.status(500).json({ success: false, error: err.message });
  }
});


// ══════════════════════════════════════════════════════════════════════════════
// ADMIN CUSTOMER EDIT ROUTES
// ══════════════════════════════════════════════════════════════════════════════

// PUT /admin/customer/profile — edit any customer profile
app.put('/admin/customer/profile', function(req, res) {
  var phone    = req.body.phone;
  var customer = findCustomer(phone);
  if (!customer) return res.status(404).json({ success: false, error: 'Customer not found' });

  // Update allowed fields
  var fields = ['name','email','city','dob','anniversary','referral_used','analyses_count','savings_shown'];
  fields.forEach(function(f) {
    if (req.body[f] !== undefined && req.body[f] !== '') customer[f] = req.body[f];
  });
  customer.updated_at = new Date().toISOString();
  updateCustomer(customer);
  res.json({ success: true, customer: customer });
});

// PUT /admin/customer/gold — edit digital gold balance
app.put('/admin/customer/gold', function(req, res) {
  var phone    = req.body.phone;
  var users    = loadGoldDB();
  var idx      = users.findIndex(function(u) { return u.phone === phone; });

  if (idx === -1) {
    // Create gold account if doesn't exist
    var customer = findCustomer(phone);
    users.push({
      phone          : phone,
      name           : customer ? customer.name : '',
      gold_grams     : parseFloat(req.body.gold_grams) || 0,
      total_invested : parseFloat(req.body.total_invested) || 0,
      transactions   : [],
      created_at     : new Date().toISOString(),
    });
    idx = users.length - 1;
  }

  var user = users[idx];

  // Update gold balance
  if (req.body.gold_grams !== undefined) user.gold_grams     = parseFloat(req.body.gold_grams) || 0;
  if (req.body.total_invested !== undefined) user.total_invested = parseFloat(req.body.total_invested) || 0;

  // Add admin adjustment transaction
  var prevGrams = parseFloat(user.gold_grams) || 0;
  var newGrams  = parseFloat(req.body.gold_grams) || 0;
  var diff      = newGrams - prevGrams;
  if (Math.abs(diff) > 0.0001) {
    user.transactions = user.transactions || [];
    user.transactions.unshift({
      type     : diff > 0 ? 'admin_credit' : 'admin_debit',
      grams    : Math.abs(diff),
      amount   : 0,
      rate     : 0,
      timestamp: new Date().toISOString(),
      notes    : 'Admin adjustment by ' + (req.body.admin_note || 'admin'),
    });
  }

  users[idx] = user;
  saveGoldDB(users);
  res.json({ success: true, user: user });
});

// PUT /admin/customer/scheme — edit a saving scheme
app.put('/admin/customer/scheme', function(req, res) {
  var schemeId = req.body.scheme_id;
  var schemes  = loadSchemesDB();
  var idx      = schemes.findIndex(function(s) { return s.scheme_id === schemeId; });
  if (idx === -1) return res.status(404).json({ success: false, error: 'Scheme not found' });

  var scheme = schemes[idx];
  var fields = ['monthly_amount','paid_months','status','nominee_name','payment_day','duration_months'];
  fields.forEach(function(f) {
    if (req.body[f] !== undefined) scheme[f] = req.body[f];
  });
  scheme.updated_at = new Date().toISOString();
  schemes[idx] = scheme;
  saveSchemesDB(schemes);
  res.json({ success: true, scheme: scheme });
});

// DELETE /admin/customer/scheme — delete a scheme
app.delete('/admin/customer/scheme/:id', function(req, res) {
  var schemeId = req.params.id;
  var schemes  = loadSchemesDB();
  var updated  = schemes.filter(function(s) { return s.scheme_id !== schemeId; });
  saveSchemesDB(updated);
  res.json({ success: true });
});

// POST /admin/customer/gold/transaction — add manual transaction
app.post('/admin/customer/gold/transaction', function(req, res) {
  var phone = req.body.phone;
  var users = loadGoldDB();
  var idx   = users.findIndex(function(u) { return u.phone === phone; });
  if (idx === -1) return res.status(404).json({ success: false, error: 'Gold account not found' });

  var user   = users[idx];
  var type   = req.body.type || 'admin_credit'; // buy, sell, reward, admin_credit, admin_debit
  var grams  = parseFloat(req.body.grams) || 0;
  var amount = parseFloat(req.body.amount) || 0;
  var rates  = getRates();

  user.transactions = user.transactions || [];
  user.transactions.unshift({
    type     : type,
    grams    : grams,
    amount   : amount,
    rate     : rates.gold_24k || 9850,
    timestamp: new Date().toISOString(),
    notes    : req.body.notes || 'Admin manual entry',
  });

  // Update balance
  if (type === 'buy' || type === 'admin_credit' || type === 'reward') {
    user.gold_grams     = (parseFloat(user.gold_grams)||0) + grams;
    user.total_invested = (parseFloat(user.total_invested)||0) + amount;
  } else if (type === 'sell' || type === 'admin_debit' || type === 'redeem') {
    user.gold_grams = Math.max(0, (parseFloat(user.gold_grams)||0) - grams);
  }

  users[idx] = user;
  saveGoldDB(users);
  res.json({ success: true, user: user });
});

// DELETE /admin/customer/:phone — delete customer account
app.delete('/admin/customer/:phone', function(req, res) {
  var phone    = decodeURIComponent(req.params.phone);
  var customers = loadCustomers();
  var updated  = customers.filter(function(c) { return c.phone !== phone; });
  saveCustomers(updated);
  res.json({ success: true });
});


// ── Admin Panel Extra Routes ───────────────────────────────────────────────

// GET /gold/users — all gold accounts
app.get('/gold/users', function(req, res) {
  var users = loadGoldDB();
  // Enrich with customer name
  var customers = loadCustomers();
  users = users.map(function(u) {
    var c = customers.find(function(c) { return c.phone === u.phone; });
    return Object.assign({}, u, { name: c ? c.name : u.name });
  });
  res.json({ success: true, users: users });
});

// GET /gold/all-schemes — all schemes enriched
app.get('/gold/all-schemes', function(req, res) {
  var schemes   = loadSchemesDB();
  var customers = loadCustomers();
  schemes = schemes.map(function(s) {
    var c = customers.find(function(c) { return c.phone === s.phone; });
    return Object.assign({}, s, { name: c ? c.name : '' });
  });
  res.json({ success: true, schemes: schemes });
});

// POST /admin/rates — save rates
app.post('/admin/rates', function(req, res) {
  var rates = getRates();
  var body  = req.body;
  var fields = ['gold_24k','gold_22k','gold_18k','gold_14k','silver','platinum','diamond','stone'];
  fields.forEach(function(f) {
    if (body[f] !== undefined) rates[f] = parseFloat(body[f]) || 0;
  });
  saveRates(rates);
  res.json({ success: true, rates: rates });
});

// Global error handler — never expose stack traces
app.use(function(err, req, res, next) {
  var ip = req.ip || '';
  if (err.code === 'LIMIT_FILE_SIZE') {
    return res.status(400).json({ success:false, error:'File too large. Maximum 8MB.' });
  }
  if (err.message && err.message.indexOf('Only image') !== -1) {
    trackIP(ip, 'block');
    return res.status(400).json({ success:false, error:'Invalid file type.' });
  }
  if (err.type === 'entity.too.large') {
    return res.status(400).json({ success:false, error:'Request too large.' });
  }
  console.error('[ERROR]', req.method, req.path, err.message);
  res.status(500).json({ success:false, error:'Something went wrong. Please try again.' });
});

app.use(function(req, res) { res.status(404).json({ success: false, error: 'Not found.' }); });
app.use(function(err, req, res, next) {
  if (err.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ success: false, error: 'File too large. Max 10MB.' });
  res.status(500).json({ success: false, error: err.message || 'Internal error.' });
});

// ── Start + warm up browser ───────────────────────────────────────────────────

app.listen(PORT, async function() {
  var r = getRates();
  console.log('\nSaheehisab AI running on http://localhost:' + PORT);
  console.log('OpenAI    : ' + (process.env.OPENAI_API_KEY      ? 'SET' : 'MISSING'));
  console.log('BrightData: ' + (process.env.BRIGHTDATA_USERNAME ? 'SET (fallback only)' : 'NOT SET'));
  console.log('22K Rate  : Rs.' + r.gold_22k + '/g  |  Making (plain): ' + r.making_plain + '%\n');

  // Pre-launch browser so first request doesn't pay the cold-start cost
  try {
    await getBrowser();
    console.log('[browser] Warmed up and ready\n');
  } catch (e) {
    console.warn('[browser] Warm-up failed (will retry on first request):', e.message);
  }
});

// Temp debug - remove later