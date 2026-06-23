<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Privacy Policy — VANDL VHS</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap&font-display=swap" rel="stylesheet">
<style>
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
:root{--ink:#111827;--ink-2:#374151;--ink-3:#6b7280;--ink-4:#9ca3af;--border:#e5e7eb;--surface:#fff;--bg:#f7f8f9;--brand:#b91c1c;--brand-bg:#fff1f1;--brand-bd:#fecaca;--blue:#2563eb;--blue-bg:#eff6ff;--blue-bd:#bfdbfe;--green:#059669;--green-bg:#ecfdf5;--green-bd:#a7f3d0;--radius:10px;--radius-lg:14px}
@media(prefers-reduced-motion:reduce){*{transition:none!important}}
html{scroll-behavior:smooth}
body{font-family:'Inter',-apple-system,sans-serif;background:var(--bg);color:var(--ink);font-size:16px;line-height:1.7;-webkit-font-smoothing:antialiased}
.skip-link{position:absolute;top:-100px;left:12px;background:var(--brand);color:#fff;padding:8px 16px;border-radius:6px;font-size:14px;font-weight:500;z-index:9999;text-decoration:none}
.skip-link:focus{top:12px}
.topbar{background:var(--surface);border-bottom:1px solid var(--border);padding:0 2rem;height:60px;display:flex;align-items:center;gap:12px;position:sticky;top:0;z-index:10;box-shadow:0 1px 2px rgba(0,0,0,.05)}
.logo{display:flex;align-items:center;gap:10px;font-size:16px;font-weight:700;color:var(--ink);text-decoration:none}
.logo-icon{width:32px;height:32px;border-radius:8px;background:var(--brand);display:flex;align-items:center;justify-content:center}
.logo-icon svg{width:16px;height:16px;fill:none;stroke:#fff;stroke-width:2.2;stroke-linecap:round;stroke-linejoin:round}
.logo em{color:var(--brand);font-style:normal}
.back{margin-left:auto;font-size:13px;color:var(--ink-3);text-decoration:none;display:flex;align-items:center;gap:6px;padding:8px 12px;border:1px solid var(--border);border-radius:6px;transition:color .15s,border-color .15s;min-height:36px}
.back:hover{color:var(--brand);border-color:var(--brand-bd)}
.back:focus-visible{outline:2px solid var(--brand);outline-offset:2px}
.page{max-width:760px;margin:0 auto;padding:3rem 1.5rem 5rem}
h1{font-size:28px;font-weight:700;letter-spacing:-.4px;margin-bottom:8px}
.meta{font-size:13px;color:var(--ink-3);margin-bottom:2.5rem}
h2{font-size:17px;font-weight:600;margin:2.25rem 0 .75rem;color:var(--ink);display:flex;align-items:center;gap:8px}
h2::before{content:'';width:3px;height:18px;border-radius:2px;background:var(--brand);flex-shrink:0}
h3{font-size:15px;font-weight:600;margin:1.5rem 0 .5rem;color:var(--ink-2)}
p{color:var(--ink-2);margin-bottom:1rem;line-height:1.75}
ul{color:var(--ink-2);margin:.5rem 0 1rem 1.5rem}
ul li{margin-bottom:6px;line-height:1.65}
.info-box{background:var(--blue-bg);border:1px solid var(--blue-bd);border-radius:var(--radius-lg);padding:1rem 1.25rem;margin:1.5rem 0;color:#1e3a8a;font-size:14px;display:flex;gap:10px;align-items:flex-start;line-height:1.6}
.info-box svg{flex-shrink:0;margin-top:1px}
.warn-box{background:var(--brand-bg);border:1px solid var(--brand-bd);border-radius:var(--radius-lg);padding:1rem 1.25rem;margin:1.5rem 0;color:#7f1d1d;font-size:14px;display:flex;gap:10px;align-items:flex-start;line-height:1.6}
.warn-box svg{flex-shrink:0;margin-top:1px}
.green-box{background:var(--green-bg);border:1px solid var(--green-bd);border-radius:var(--radius-lg);padding:1rem 1.25rem;margin:1.5rem 0;color:#065f46;font-size:14px;display:flex;gap:10px;align-items:flex-start;line-height:1.6}
.green-box svg{flex-shrink:0;margin-top:1px}
.rights-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin:1rem 0}
.rights-card{background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);padding:14px 16px}
.rights-card strong{display:block;font-size:13px;color:var(--ink);margin-bottom:4px}
.rights-card span{font-size:12px;color:var(--ink-3);line-height:1.5}
.region-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin:1rem 0}
.region-card{background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);padding:12px 14px;font-size:13px}
.region-card strong{display:block;color:var(--ink);margin-bottom:3px;font-size:13px}
.region-card span{color:var(--ink-3);font-size:12px;line-height:1.5}

/* Language switcher */
.lang-wrap { position: relative; display: inline-block; margin-bottom: 1.5rem; }
.lang-toggle {
  display: inline-flex; align-items: center; gap: 8px;
  padding: 9px 16px; background: var(--surface);
  border: 1px solid var(--border); border-radius: var(--radius);
  font-size: 13px; font-weight: 500; color: var(--ink-2);
  font-family: inherit; cursor: pointer; transition: all .15s;
  white-space: nowrap;
}
.lang-toggle:hover { border-color: var(--brand); color: var(--brand); }
.lang-toggle svg { transition: transform .2s; }
.lang-toggle.open svg { transform: rotate(180deg); }

.lang-dropdown {
  display: none; position: absolute; top: calc(100% + 6px); left: 0;
  background: var(--surface); border: 1px solid var(--border);
  border-radius: var(--radius-lg); box-shadow: 0 8px 24px rgba(0,0,0,.12);
  z-index: 100; min-width: 200px;
  max-height: 340px; overflow-y: auto;
  animation: dropIn .15s ease-out;
}
.lang-dropdown.open { display: block; }
@keyframes dropIn { from { opacity:0; transform:translateY(-6px) } to { opacity:1; transform:translateY(0) } }

.lang-option {
  display: block; width: 100%; padding: 10px 16px;
  text-align: left; background: none; border: none;
  font-size: 13px; font-family: inherit; color: var(--ink-2);
  cursor: pointer; transition: background .1s;
  white-space: nowrap;
}
.lang-option:hover { background: var(--bg-2); color: var(--brand); }
.lang-option.active { background: var(--brand-bg); color: var(--brand); font-weight: 600; }
.lang-option:first-child { border-radius: var(--radius-lg) var(--radius-lg) 0 0; }
.lang-option:last-child { border-radius: 0 0 var(--radius-lg) var(--radius-lg); }
.lang-divider { height: 1px; background: var(--border); margin: 4px 0; }
.notranslate { font-family: inherit; }


/* Accordion */
.accordion { border: 1px solid var(--border); border-radius: var(--radius-lg); overflow: hidden; margin: 1rem 0; }
.accordion + .accordion { margin-top: 8px; }
.acc-trigger {
  width: 100%; display: flex; align-items: center; justify-content: space-between;
  padding: 14px 18px; background: var(--surface); border: none;
  font-family: inherit; font-size: 14px; font-weight: 600; color: var(--ink);
  cursor: pointer; text-align: left; transition: background .15s;
  gap: 12px;
}
.acc-trigger:hover { background: var(--bg-2); }
.acc-trigger.open { background: var(--brand-bg); color: var(--brand); border-bottom: 1px solid var(--brand-bd); }
.acc-trigger-left { display: flex; align-items: center; gap: 10px; }
.acc-flag { font-size: 18px; flex-shrink: 0; }
.acc-arrow { flex-shrink: 0; transition: transform .2s; color: var(--ink-4); }
.acc-trigger.open .acc-arrow { transform: rotate(180deg); color: var(--brand); }
.acc-body { display: none; padding: 16px 18px; background: var(--surface); border-top: 1px solid var(--border); font-size: 14px; color: var(--ink-2); line-height: 1.7; }
.acc-body.open { display: block; }
.acc-body ul { margin: .5rem 0 .5rem 1.25rem; }
.acc-body ul li { margin-bottom: 5px; line-height: 1.6; }
.acc-body p { margin-bottom: .75rem; }
.acc-body p:last-child { margin-bottom: 0; }
.acc-group-label { font-size: 11px; font-weight: 600; color: var(--ink-4); text-transform: uppercase; letter-spacing: .06em; margin: 1.5rem 0 .5rem; }

.site-footer{text-align:center;font-size:12px;color:var(--ink-4);margin-top:3rem;padding-top:1.5rem;border-top:1px solid var(--border)}
.site-footer a{color:var(--ink-3);text-decoration:none}
.site-footer a:hover{color:var(--brand)}
@media(max-width:600px){.page{padding:2rem 1rem 4rem}h1{font-size:22px}.rights-grid,.region-grid{grid-template-columns:1fr}}
</style>
</head>
<body>
<a href="#main-content" class="skip-link">Skip to main content</a>
<nav class="topbar" aria-label="Site navigation">
  <a href="/" class="logo" aria-label="VANDL VHS home">
    <div class="logo-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M12 2L8 9H3l4.5 5.5L5 22l7-4.5L19 22l-2.5-7.5L21 9h-5L12 2z"/></svg></div>
    VANDL<em>VHS</em>
  </a>
  <a href="/" class="back">&#8592; Back</a>
</nav>
<main class="page" id="main-content">
  <h1>Privacy Policy</h1>
  <p class="meta">Last updated: June 23, 2026 &nbsp;·&nbsp; Effective immediately &nbsp;·&nbsp; Applies globally</p>

  <!-- Language Switcher -->
  <div class="lang-wrap notranslate" id="lang-wrap">
    <button class="lang-toggle" id="lang-toggle" onclick="toggleLangMenu()" aria-haspopup="listbox" aria-expanded="false">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>
      <span id="lang-current">English</span>
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" aria-hidden="true"><polyline points="6 9 12 15 18 9"/></svg>
    </button>
    <div class="lang-dropdown" id="lang-dropdown" role="listbox" aria-label="Select language">
      <button class="lang-option active notranslate" onclick="switchLang('en','English')" role="option">🇬🇧 English</button>
      <div class="lang-divider"></div>
      <button class="lang-option notranslate" onclick="switchLang('zh-CN','简体中文')" role="option">🇨🇳 简体中文</button>
      <button class="lang-option notranslate" onclick="switchLang('zh-TW','繁體中文')" role="option">🇹🇼 繁體中文</button>
      <div class="lang-divider"></div>
      <button class="lang-option notranslate" onclick="switchLang('es','Español')" role="option">🇪🇸 Español</button>
      <button class="lang-option notranslate" onclick="switchLang('fr','Français')" role="option">🇫🇷 Français</button>
      <button class="lang-option notranslate" onclick="switchLang('de','Deutsch')" role="option">🇩🇪 Deutsch</button>
      <button class="lang-option notranslate" onclick="switchLang('it','Italiano')" role="option">🇮🇹 Italiano</button>
      <button class="lang-option notranslate" onclick="switchLang('pt','Português')" role="option">🇵🇹 Português</button>
      <button class="lang-option notranslate" onclick="switchLang('nl','Nederlands')" role="option">🇳🇱 Nederlands</button>
      <button class="lang-option notranslate" onclick="switchLang('pl','Polski')" role="option">🇵🇱 Polski</button>
      <button class="lang-option notranslate" onclick="switchLang('ru','Русский')" role="option">🇷🇺 Русский</button>
      <button class="lang-option notranslate" onclick="switchLang('tr','Türkçe')" role="option">🇹🇷 Türkçe</button>
      <div class="lang-divider"></div>
      <button class="lang-option notranslate" onclick="switchLang('ar','العربية')" role="option">🇸🇦 العربية</button>
      <button class="lang-option notranslate" onclick="switchLang('hi','हिन्दी')" role="option">🇮🇳 हिन्दी</button>
      <button class="lang-option notranslate" onclick="switchLang('ja','日本語')" role="option">🇯🇵 日本語</button>
      <button class="lang-option notranslate" onclick="switchLang('ko','한국어')" role="option">🇰🇷 한국어</button>
      <button class="lang-option notranslate" onclick="switchLang('ms','Bahasa Melayu')" role="option">🇲🇾 Bahasa Melayu</button>
      <button class="lang-option notranslate" onclick="switchLang('id','Bahasa Indonesia')" role="option">🇮🇩 Bahasa Indonesia</button>
      <button class="lang-option notranslate" onclick="switchLang('th','ภาษาไทย')" role="option">🇹🇭 ภาษาไทย</button>
      <button class="lang-option notranslate" onclick="switchLang('vi','Tiếng Việt')" role="option">🇻🇳 Tiếng Việt</button>
    </div>
  </div>

  <div class="info-box" role="note">
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
    <span>This Privacy Policy applies to all users of VANDL Health Score (VHS) worldwide. We are committed to compliance with applicable privacy laws in every jurisdiction where our Service is accessible, including GDPR (EU/EEA/UK), COPPA (USA), PIPL (China), LGPD (Brazil), PIPEDA (Canada), Privacy Act (Australia), POPIA (South Africa), PDPA (Singapore), DPDP (India), PIPA (South Korea), APPI (Japan), and others.</span>
  </div>

  <h2>1. Who We Are</h2>
  <p>VANDL Health Score (VHS) is a wellness education and health management platform accessible at bloodrx.onrender.com. We use artificial intelligence to analyze submitted health documents and generate wellness assessments for adults aged 18 and over.</p>
  <p>This Service is operated globally and is subject to the data protection laws of all jurisdictions from which it is accessed.</p>

  <h2>2. Age Restriction — Strictly 18+</h2>
  <div class="warn-box" role="alert">
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
    <div>
      <strong style="display:block;margin-bottom:4px">No data from persons under 18</strong>
      This Service is strictly for users aged 18 and over. We do not knowingly collect, process, or store personal data from individuals under 18. In compliance with COPPA (USA), we do not knowingly collect data from children under 13 under any circumstances. If we discover we have collected data from a minor, we will delete it immediately within 48 hours. To report data belonging to a minor, contact us through the Service immediately.
    </div>
  </div>

  <h2>3. Data We Collect</h2>
  <p>We collect only the minimum data necessary to provide the Service (data minimization principle):</p>
  <ul>
    <li><strong>Identity data:</strong> Name, age, gender (voluntarily entered)</li>
    <li><strong>Contact data:</strong> Phone number (optional)</li>
    <li><strong>Health data:</strong> Symptoms, clinical notes, uploaded health documents — classified as sensitive/special category data under applicable law</li>
    <li><strong>Assessment results:</strong> AI-generated VHS score, risk profile, wellness recommendations</li>
    <li><strong>Technical data:</strong> IP address, timestamp, document language detected</li>
    <li><strong>Age verification:</strong> A timestamp stored in your browser's local storage confirming you confirmed you are 18+ (no personal data, stored locally only, expires in 30 days)</li>
  </ul>
  <p>We do <strong>not</strong> collect: payment information, government IDs, passwords, biometric data, precise location, browsing history, or any data not listed above.</p>

  <h2>4. Legal Basis for Processing</h2>
  <p>We process your data on the following legal bases depending on your jurisdiction:</p>
  <ul>
    <li><strong>Consent (GDPR Art. 6(1)(a) and Art. 9(2)(a)):</strong> You provide explicit consent at the time of submission for processing of health data (special category data)</li>
    <li><strong>Legitimate interests (GDPR Art. 6(1)(f)):</strong> Providing and improving the Service, detecting fraud and abuse</li>
    <li><strong>Legal obligation:</strong> Compliance with applicable laws</li>
  </ul>
  <p>Health data is classified as special category data under GDPR Article 9 and equivalent laws. Processing requires your explicit consent, which you provide at the time of submission.</p>

  <h2>5. How We Use Your Data</h2>
  <p>Your data is used exclusively for:</p>
  <ul>
    <li>Generating AI-assisted wellness assessments (the primary purpose)</li>
    <li>Maintaining assessment records for authorized administrators</li>
    <li>Improving Service accuracy and reliability</li>
    <li>Complying with legal obligations</li>
    <li>Detecting and preventing fraud and abuse</li>
  </ul>
  <p>We do <strong>not</strong> sell, rent, share, or use your data for advertising, profiling, or marketing under any circumstances.</p>

  <h2>6. AI Processing Disclosure (EU AI Act Article 50)</h2>
  <div class="info-box" role="note">
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/></svg>
    <div>
      <strong style="display:block;margin-bottom:4px">AI-Generated Content Disclosure</strong>
      In compliance with EU AI Act Article 50 (effective August 2, 2026), we disclose that: (1) All wellness assessment reports on this platform are generated by artificial intelligence. (2) The Help Assistant is an AI chatbot — not a human. (3) AI-generated content is clearly labelled on all results pages. VANDL VHS is classified as a limited-risk AI system under the EU AI Act and is not a regulated medical device.
    </div>
  </div>

  <h2>7. Third-Party AI Processing (Anthropic)</h2>
  <p>This Service uses Anthropic's Claude AI model to process submitted health data. When you submit a document:</p>
  <ul>
    <li>Document content and context information is transmitted to Anthropic's API servers for processing</li>
    <li>Anthropic processes this data under their own Privacy Policy (anthropic.com/privacy)</li>
    <li>Data may be processed in the United States or other jurisdictions where Anthropic operates</li>
    <li>EU/EEA users: this constitutes a cross-border data transfer. Anthropic participates in applicable transfer mechanisms including Standard Contractual Clauses</li>
    <li>China users: please note that data submitted may be transferred outside mainland China for AI processing — see Section 12 (China PIPL) below</li>
  </ul>
  <p>By using this Service, you explicitly consent to this third-party AI processing of your health data.</p>

  <h2>8. Data Storage and Security</h2>
  <p>Assessment records are stored in MongoDB Atlas (cloud database, hosted by MongoDB Inc.). Security measures include:</p>
  <ul>
    <li>HTTPS/TLS encryption for all data in transit</li>
    <li>MongoDB Atlas encryption at rest</li>
    <li>Password-protected admin access with brute-force lockout (15-minute lockout after 5 failed attempts)</li>
    <li>Rate limiting on all API endpoints</li>
    <li>Content Security Policy and security headers preventing common web attacks</li>
    <li>Input sanitization preventing injection attacks</li>
    <li>IP addresses stored but never displayed in any user interface</li>
    <li>Admin data API never returns raw MongoDB IDs or IP addresses</li>
  </ul>
  <p>No system is 100% secure. In the event of a data breach that is likely to result in risk to your rights and freedoms, we will notify relevant authorities within 72 hours (as required by GDPR and equivalent laws) and affected users without undue delay.</p>

  <h2>9. Data Retention</h2>
  <p>Assessment records are retained for as long as the Service operates, or until deletion is requested. You may request deletion of your data at any time. We will process deletion requests within 30 days. Data may be retained longer where required by applicable law or for legitimate legal defense purposes.</p>

  <h2>10. Your Rights</h2>
  <p>You have the following rights regarding your personal data (applicable rights vary by jurisdiction):</p>
  <div class="rights-grid">
    <div class="rights-card"><strong>Right to Access</strong><span>Request a copy of all personal data we hold about you</span></div>
    <div class="rights-card"><strong>Right to Rectification</strong><span>Request correction of inaccurate or incomplete data</span></div>
    <div class="rights-card"><strong>Right to Erasure</strong><span>Request deletion of your data ("right to be forgotten")</span></div>
    <div class="rights-card"><strong>Right to Portability</strong><span>Receive your data in a structured, machine-readable format</span></div>
    <div class="rights-card"><strong>Right to Object</strong><span>Object to processing of your data for certain purposes</span></div>
    <div class="rights-card"><strong>Right to Restrict</strong><span>Request restriction of processing in certain circumstances</span></div>
    <div class="rights-card"><strong>Right to Withdraw Consent</strong><span>Withdraw consent at any time without affecting prior processing</span></div>
    <div class="rights-card"><strong>Right to Complain</strong><span>Lodge a complaint with your national data protection authority</span></div>
  </div>
  <p>To exercise any of these rights, contact us through the Service. We will respond within 30 days at no charge.</p>

  <h2>11. Global Regional Compliance</h2>
  <p class="acc-group-label">Americas</p>

  <div class="accordion">
    <button class="acc-trigger" onclick="toggleAcc(this)" aria-expanded="false">
      <span class="acc-trigger-left"><span class="acc-flag">🇺🇸</span> USA — COPPA &amp; FTC Act</span>
      <svg class="acc-arrow" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><polyline points="6 9 12 15 18 9"/></svg>
    </button>
    <div class="acc-body">
      <ul>
        <li><strong>COPPA:</strong> We do not knowingly collect any data from children under 13 under any circumstances. Our platform is 18+ globally.</li>
        <li><strong>FTC Act:</strong> We do not engage in unfair or deceptive data practices. Our privacy disclosures are clear and accurate.</li>
        <li><strong>HIPAA:</strong> This platform is NOT a HIPAA-covered entity. Do not submit Protected Health Information (PHI). See Section 13 for full HIPAA notice.</li>
        <li><strong>State laws (CCPA/CPRA):</strong> California residents have rights to know, delete, correct, and opt out of sale of personal data. We do not sell personal data.</li>
      </ul>
    </div>
  </div>

  <div class="accordion">
    <button class="acc-trigger" onclick="toggleAcc(this)" aria-expanded="false">
      <span class="acc-trigger-left"><span class="acc-flag">🇧🇷</span> Brazil — LGPD</span>
      <svg class="acc-arrow" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><polyline points="6 9 12 15 18 9"/></svg>
    </button>
    <div class="acc-body">
      <p>We comply with Lei Geral de Proteção de Dados (LGPD — Law 13.709/2018). Health data is sensitive data requiring explicit consent under LGPD Article 11.</p>
      <ul>
        <li>Legal basis: explicit consent (Article 7, VIII and Article 11, I)</li>
        <li>Rights: access, correction, deletion, portability, information about sharing, and right to revoke consent</li>
        <li>Supervisory authority: ANPD (Autoridade Nacional de Proteção de Dados)</li>
        <li>Cross-border transfers: covered by consent and adequacy mechanisms</li>
      </ul>
    </div>
  </div>

  <div class="accordion">
    <button class="acc-trigger" onclick="toggleAcc(this)" aria-expanded="false">
      <span class="acc-trigger-left"><span class="acc-flag">🇨🇦</span> Canada — PIPEDA</span>
      <svg class="acc-arrow" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><polyline points="6 9 12 15 18 9"/></svg>
    </button>
    <div class="acc-body">
      <p>We comply with the Personal Information Protection and Electronic Documents Act (PIPEDA) and applicable provincial privacy laws.</p>
      <ul>
        <li>Health data is classified as sensitive personal information requiring meaningful consent</li>
        <li>Rights: access and correction of personal information</li>
        <li>Breach notification: we notify affected individuals and the OPC where required</li>
        <li>Supervisory authority: Office of the Privacy Commissioner (OPC)</li>
      </ul>
    </div>
  </div>

  <p class="acc-group-label">Europe</p>

  <div class="accordion">
    <button class="acc-trigger" onclick="toggleAcc(this)" aria-expanded="false">
      <span class="acc-trigger-left"><span class="acc-flag">🇪🇺</span> EU / EEA — GDPR</span>
      <svg class="acc-arrow" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><polyline points="6 9 12 15 18 9"/></svg>
    </button>
    <div class="acc-body">
      <p>We comply with the General Data Protection Regulation (GDPR — Regulation EU 2016/679). Health data is special category data under Article 9 requiring explicit consent.</p>
      <ul>
        <li><strong>Legal basis:</strong> Explicit consent (Art. 6(1)(a) and Art. 9(2)(a)) for health data processing</li>
        <li><strong>Rights:</strong> Access, rectification, erasure, portability, objection, restriction — all honored within 30 days</li>
        <li><strong>Cross-border transfers:</strong> Data transmitted to Anthropic (US) under Standard Contractual Clauses</li>
        <li><strong>Data breach:</strong> Supervisory authority notification within 72 hours, user notification without undue delay</li>
        <li><strong>EU AI Act Article 50:</strong> AI-generated content is labelled; the Help Assistant discloses it is an AI</li>
        <li><strong>Supervisory authority:</strong> Your national DPA (e.g. CNIL in France, BfDI in Germany, ICO in UK)</li>
        <li><strong>DPO:</strong> We are a small platform and do not currently have a designated DPO. Contact us through the Service for data requests.</li>
      </ul>
    </div>
  </div>

  <div class="accordion">
    <button class="acc-trigger" onclick="toggleAcc(this)" aria-expanded="false">
      <span class="acc-trigger-left"><span class="acc-flag">🇬🇧</span> United Kingdom — UK GDPR + DPA 2018</span>
      <svg class="acc-arrow" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><polyline points="6 9 12 15 18 9"/></svg>
    </button>
    <div class="acc-body">
      <p>Post-Brexit, we comply with UK GDPR and the Data Protection Act 2018. UK data protection rights are substantially equivalent to EU GDPR.</p>
      <ul>
        <li>All GDPR rights apply equally to UK users</li>
        <li>Health data treated as special category data requiring explicit consent</li>
        <li>Supervisory authority: Information Commissioner's Office (ICO)</li>
        <li>UK users may lodge complaints with the ICO: ico.org.uk</li>
      </ul>
    </div>
  </div>

  <p class="acc-group-label">Asia Pacific</p>

  <div class="accordion">
    <button class="acc-trigger" onclick="toggleAcc(this)" aria-expanded="false">
      <span class="acc-trigger-left"><span class="acc-flag">🇨🇳</span> China — PIPL (Important)</span>
      <svg class="acc-arrow" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><polyline points="6 9 12 15 18 9"/></svg>
    </button>
    <div class="acc-body">
      <p><strong>⚠️ Cross-Border Transfer Notice for Mainland China Users</strong></p>
      <p>China's Personal Information Protection Law (PIPL) requires health data (sensitive personal information) to be stored on domestic servers with government security assessments before cross-border transfers.</p>
      <ul>
        <li>VANDL VHS stores data on MongoDB Atlas servers located outside mainland China</li>
        <li>Data is transmitted to Anthropic's API (US-based) for AI processing</li>
        <li>By using the Service, mainland China users explicitly consent to this cross-border transfer under PIPL Article 38</li>
        <li>Users requiring full PIPL-compliant data localization should not use this Service</li>
        <li>Rights under PIPL: access, correction, deletion, restriction of processing — honored within 30 days</li>
      </ul>
    </div>
  </div>

  <div class="accordion">
    <button class="acc-trigger" onclick="toggleAcc(this)" aria-expanded="false">
      <span class="acc-trigger-left"><span class="acc-flag">🇭🇰</span> Hong Kong — PDPO</span>
      <svg class="acc-arrow" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><polyline points="6 9 12 15 18 9"/></svg>
    </button>
    <div class="acc-body">
      <p>We comply with the Personal Data (Privacy) Ordinance (PDPO) Cap. 486 of Hong Kong.</p>
      <ul>
        <li>Data collection limited to the minimum necessary for the stated purpose</li>
        <li>Rights: data access and correction requests honored within 40 days</li>
        <li>Supervisory authority: Privacy Commissioner for Personal Data (PCPD)</li>
      </ul>
    </div>
  </div>

  <div class="accordion">
    <button class="acc-trigger" onclick="toggleAcc(this)" aria-expanded="false">
      <span class="acc-trigger-left"><span class="acc-flag">🇹🇼</span> Taiwan — PDPA</span>
      <svg class="acc-arrow" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><polyline points="6 9 12 15 18 9"/></svg>
    </button>
    <div class="acc-body">
      <p>We comply with Taiwan's Personal Data Protection Act (個人資料保護法).</p>
      <ul>
        <li>Health data treated as sensitive personal data requiring explicit consent</li>
        <li>Rights: access, correction, deletion, restriction of processing, and objection</li>
        <li>Supervisory authority: Personal Data Protection Commission (PDPC)</li>
      </ul>
    </div>
  </div>

  <div class="accordion">
    <button class="acc-trigger" onclick="toggleAcc(this)" aria-expanded="false">
      <span class="acc-trigger-left"><span class="acc-flag">🇯🇵</span> Japan — APPI</span>
      <svg class="acc-arrow" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><polyline points="6 9 12 15 18 9"/></svg>
    </button>
    <div class="acc-body">
      <p>We comply with Japan's Act on Protection of Personal Information (APPI — 個人情報の保護に関する法律).</p>
      <ul>
        <li>Health data classified as "special care-required personal information" requiring prior consent</li>
        <li>Rights: disclosure, correction, deletion, and suspension of use</li>
        <li>Supervisory authority: Personal Information Protection Commission (PPC)</li>
        <li>Japan is recognized as adequate by the EU for cross-border data transfers</li>
      </ul>
    </div>
  </div>

  <div class="accordion">
    <button class="acc-trigger" onclick="toggleAcc(this)" aria-expanded="false">
      <span class="acc-trigger-left"><span class="acc-flag">🇰🇷</span> South Korea — PIPA</span>
      <svg class="acc-arrow" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><polyline points="6 9 12 15 18 9"/></svg>
    </button>
    <div class="acc-body">
      <p>We comply with South Korea's Personal Information Protection Act (PIPA — 개인정보 보호법).</p>
      <ul>
        <li>Health data classified as sensitive information requiring separate explicit consent</li>
        <li>Rights: access, correction, deletion, suspension of processing</li>
        <li>Breach notification required to PIPC and affected users</li>
        <li>Supervisory authority: Personal Information Protection Commission (PIPC)</li>
      </ul>
    </div>
  </div>

  <div class="accordion">
    <button class="acc-trigger" onclick="toggleAcc(this)" aria-expanded="false">
      <span class="acc-trigger-left"><span class="acc-flag">🇸🇬</span> Singapore — PDPA</span>
      <svg class="acc-arrow" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><polyline points="6 9 12 15 18 9"/></svg>
    </button>
    <div class="acc-body">
      <p>We comply with Singapore's Personal Data Protection Act 2012 (PDPA).</p>
      <ul>
        <li>Consent-based data collection and processing</li>
        <li>Data minimization and purpose limitation observed</li>
        <li>Rights: access and correction of personal data</li>
        <li>Supervisory authority: Personal Data Protection Commission (PDPC)</li>
      </ul>
    </div>
  </div>

  <div class="accordion">
    <button class="acc-trigger" onclick="toggleAcc(this)" aria-expanded="false">
      <span class="acc-trigger-left"><span class="acc-flag">🇮🇳</span> India — DPDP</span>
      <svg class="acc-arrow" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><polyline points="6 9 12 15 18 9"/></svg>
    </button>
    <div class="acc-body">
      <p>We comply with India's Digital Personal Data Protection Act 2023 (DPDP Act).</p>
      <ul>
        <li>We act as a Data Fiduciary and observe consent-based processing obligations</li>
        <li>Rights: access, correction, erasure, and grievance redressal</li>
        <li>Data of children requires verifiable parental consent — our 18+ age gate addresses this</li>
        <li>Supervisory authority: Data Protection Board of India (once operational)</li>
      </ul>
    </div>
  </div>

  <div class="accordion">
    <button class="acc-trigger" onclick="toggleAcc(this)" aria-expanded="false">
      <span class="acc-trigger-left"><span class="acc-flag">🇮🇩</span> Indonesia — PDPL</span>
      <svg class="acc-arrow" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><polyline points="6 9 12 15 18 9"/></svg>
    </button>
    <div class="acc-body">
      <p>We comply with Indonesia's Personal Data Protection Law (UU PDP — Law No. 27 of 2022).</p>
      <ul>
        <li>Health data classified as specific personal data requiring explicit consent</li>
        <li>Rights: access, correction, deletion, and withdrawal of consent</li>
        <li>Cross-border transfer requires ensuring adequate protection in the recipient country</li>
      </ul>
    </div>
  </div>

  <div class="accordion">
    <button class="acc-trigger" onclick="toggleAcc(this)" aria-expanded="false">
      <span class="acc-trigger-left"><span class="acc-flag">🇦🇺</span> Australia — Privacy Act</span>
      <svg class="acc-arrow" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><polyline points="6 9 12 15 18 9"/></svg>
    </button>
    <div class="acc-body">
      <p>We comply with Australia's Privacy Act 1988 and the Australian Privacy Principles (APPs).</p>
      <ul>
        <li>Health information is sensitive information requiring consent for collection</li>
        <li>Rights: access and correction of personal information</li>
        <li>Notifiable Data Breaches (NDB) scheme: we notify OAIC and affected individuals for eligible breaches</li>
        <li>Supervisory authority: Office of the Australian Information Commissioner (OAIC)</li>
      </ul>
    </div>
  </div>

  <p class="acc-group-label">Africa &amp; Middle East</p>

  <div class="accordion">
    <button class="acc-trigger" onclick="toggleAcc(this)" aria-expanded="false">
      <span class="acc-trigger-left"><span class="acc-flag">🇿🇦</span> South Africa — POPIA</span>
      <svg class="acc-arrow" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><polyline points="6 9 12 15 18 9"/></svg>
    </button>
    <div class="acc-body">
      <p>We comply with South Africa's Protection of Personal Information Act (POPIA — Act 4 of 2013).</p>
      <ul>
        <li>Health data classified as special personal information requiring explicit consent</li>
        <li>Rights: access, correction, deletion, and objection</li>
        <li>Breach notification to Information Regulator and affected parties required</li>
        <li>Supervisory authority: Information Regulator of South Africa</li>
      </ul>
    </div>
  </div>

  <div class="accordion">
    <button class="acc-trigger" onclick="toggleAcc(this)" aria-expanded="false">
      <span class="acc-trigger-left"><span class="acc-flag">🇦🇪</span> UAE &amp; 🇸🇦 Saudi Arabia</span>
      <svg class="acc-arrow" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><polyline points="6 9 12 15 18 9"/></svg>
    </button>
    <div class="acc-body">
      <p>We comply with applicable data protection laws in the UAE and Saudi Arabia.</p>
      <ul>
        <li><strong>UAE:</strong> DIFC Data Protection Law 2020 (for DIFC) and Federal Decree-Law No. 45 of 2021 on Personal Data Protection</li>
        <li><strong>Saudi Arabia:</strong> Personal Data Protection Law (PDPL — Royal Decree No. M/19)</li>
        <li>Health data treated as sensitive data requiring explicit consent in both jurisdictions</li>
        <li>Rights: access, correction, deletion honored within 30 days</li>
      </ul>
    </div>
  </div>

  <h2>12. China PIPL — Important Notice for Mainland China Users</h2>
  <div class="warn-box" role="note">
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
    <div>
      <strong style="display:block;margin-bottom:4px">China PIPL Cross-Border Transfer Notice</strong>
      China's Personal Information Protection Law (PIPL) requires that health data (sensitive personal information) be stored on domestic servers, with government security assessments required before cross-border transfers. VANDL VHS stores data on MongoDB Atlas servers located outside mainland China and transmits data to Anthropic's API (US-based) for AI processing. Users in mainland China should be aware that submitting health data through this Service constitutes a cross-border transfer of sensitive personal information. By using the Service, mainland China users explicitly consent to this cross-border transfer as permitted under PIPL Article 38. Users who require PIPL-compliant data localization should not use this Service until a China-domestic version is available.
    </div>
  </div>

  <h2>13. HIPAA Notice (United States)</h2>
  <div class="warn-box" role="note">
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
    <span>VANDL Health Score (VHS) is NOT a HIPAA-covered entity and does not execute Business Associate Agreements. US healthcare providers must not submit Protected Health Information (PHI) as defined under HIPAA through this Service. Use of this Service with PHI is at the user's own legal risk.</span>
  </div>

  <h2>14. Cookies and Local Storage</h2>
  <p>We do not use cookies for tracking, advertising, or analytics. We use browser local storage solely for:</p>
  <ul>
    <li>Remembering your age verification confirmation (18+ consent) for 30 days — stored locally on your device only, never transmitted to our servers</li>
  </ul>
  <p>We do not use Google Analytics, Facebook Pixel, or any third-party tracking technology.</p>

  <h2>15. No Automated Decision-Making with Legal Effects</h2>
  <p>VANDL VHS does not make automated decisions with legal or similarly significant effects about individuals. All AI-generated wellness assessments are informational only and require human review before any action is taken.</p>

  <h2>16. Data Breach Notification</h2>
  <p>In the event of a personal data breach that is likely to result in risk to your rights and freedoms:</p>
  <ul>
    <li>We will notify the relevant supervisory authority within 72 hours (GDPR) or equivalent timeframes under applicable law</li>
    <li>We will notify affected users without undue delay where the breach is likely to result in high risk</li>
    <li>Notifications will describe the nature of the breach, data affected, and steps taken to mitigate harm</li>
  </ul>

  <h2>17. Changes to This Policy</h2>
  <p>We may update this Privacy Policy to reflect legal changes or Service updates. Significant changes will be communicated by updating the date above. For material changes affecting your rights, we will provide additional notice where required by law. Continued use of the Service after changes constitutes acceptance of the updated Policy.</p>

  <h2>18. Contact and Data Requests</h2>
  <p>For privacy questions, data access requests, data deletion requests, breach reports, or to report data belonging to a minor, contact us through the Service at bloodrx.onrender.com. We will acknowledge your request within 5 business days and respond fully within 30 days at no charge to you.</p>

  <div class="green-box" role="note">
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12"/></svg>
    <span><strong>Note:</strong> While we have taken comprehensive steps to comply with applicable global privacy laws, this platform is operated by a small team. We strongly recommend consulting a qualified data protection lawyer before using this Service to process health data of individuals in regulated jurisdictions, particularly the EU, China, South Korea, and the United States.</span>
  </div>

  <footer class="site-footer">
    <p>VANDL Health Score (VHS) &nbsp;·&nbsp; <a href="/terms">Terms of Service</a> &nbsp;·&nbsp; <a href="/">Back to Platform</a></p>
  </footer>
</main>

<!-- Google Translate -->
<div id="google_translate_element" style="display:none"></div>
<script>
function googleTranslateElementInit() {
  new google.translate.TranslateElement({ pageLanguage: 'en', autoDisplay: false }, 'google_translate_element');
}

function toggleLangMenu() {
  const toggle = document.getElementById('lang-toggle');
  const dropdown = document.getElementById('lang-dropdown');
  const isOpen = dropdown.classList.toggle('open');
  toggle.classList.toggle('open', isOpen);
  toggle.setAttribute('aria-expanded', isOpen);
}

function switchLang(lang, label) {
  // Update display
  document.getElementById('lang-current').textContent = label || 'English';
  document.querySelectorAll('.lang-option').forEach(b => b.classList.remove('active'));
  // Close dropdown
  document.getElementById('lang-dropdown').classList.remove('open');
  document.getElementById('lang-toggle').classList.remove('open');
  document.getElementById('lang-toggle').setAttribute('aria-expanded', 'false');

  if (lang === 'en') {
    document.cookie = 'googtrans=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;';
    document.cookie = 'googtrans=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/; domain=.' + location.hostname;
    window.location.reload();
    return;
  }
  const select = document.querySelector('select.goog-te-combo');
  if (select) {
    select.value = lang;
    select.dispatchEvent(new Event('change'));
  } else {
    document.cookie = 'googtrans=/en/' + lang + '; path=/';
    document.cookie = 'googtrans=/en/' + lang + '; path=/; domain=.' + location.hostname;
    window.location.reload();
  }
}

// Close dropdown when clicking outside
document.addEventListener('click', e => {
  if (!document.getElementById('lang-wrap').contains(e.target)) {
    document.getElementById('lang-dropdown').classList.remove('open');
    document.getElementById('lang-toggle').classList.remove('open');
    document.getElementById('lang-toggle').setAttribute('aria-expanded', 'false');
  }
});

// Close on Escape
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    document.getElementById('lang-dropdown').classList.remove('open');
    document.getElementById('lang-toggle').classList.remove('open');
  }
});
</script>
<script src="//translate.google.com/translate_a/element.js?cb=googleTranslateElementInit" defer></script>
<style>
/* Hide Google Translate toolbar */
.goog-te-banner-frame, .skiptranslate { display: none !important; }
body { top: 0 !important; }
.goog-te-gadget { display: none !important; }
</style>


<script>
function toggleAcc(trigger) {
  const body = trigger.nextElementSibling;
  const isOpen = body.classList.toggle('open');
  trigger.classList.toggle('open', isOpen);
  trigger.setAttribute('aria-expanded', isOpen);
}
</script>

</body>
</html>
