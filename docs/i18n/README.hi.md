<h1 align="center">
  <img src="../../docs/assets/logo.png" alt="PromptOps" width="64" valign="middle" /> PromptOps
</h1>

<p align="center">
  <a href="https://github.com/shellonback/promptops/stargazers"><img src="https://img.shields.io/github/stars/shellonback/promptops?style=flat&amp;label=%E2%98%85&amp;color=4F41FA" alt="GitHub stars" /></a>
  <img src="https://img.shields.io/badge/license-Apache--2.0-4F41FA?style=flat" alt="License: Apache-2.0" />
  <a href="https://github.com/shellonback/promptops/releases"><img src="https://img.shields.io/endpoint?url=https%3A%2F%2Fraw.githubusercontent.com%2Fshellonback%2Fpromptops%2Fbadges%2Fdownloads.json" alt="Downloads" /></a>
  <img src="https://img.shields.io/badge/macOS%20%7C%20Windows%20%7C%20Linux-4F41FA?style=flat-square" alt="Supported platforms: macOS, Windows, and Linux" />
  <a href="https://t.me/promptoperations"><img src="https://img.shields.io/badge/Telegram-promptoperations-26A5E4?style=flat&amp;logo=telegram&amp;logoColor=white" alt="Telegram channel" /></a>
</p>

<p align="center">
  <a href="../../README.md">English</a> · <a href="README.it.md">Italiano</a> · <a href="README.fr.md">Français</a> · <a href="README.es.md">Español</a> · <a href="README.de.md">Deutsch</a> · <a href="README.pt.md">Português</a> · <a href="README.zh.md">中文</a> · <a href="README.ja.md">日本語</a> · <a href="README.ru.md">Русский</a> · <a href="README.ar.md">العربية</a> · <b>हिन्दी</b> · <a href="README.pl.md">Polski</a> · <a href="README.nl.md">Nederlands</a> · <a href="README.sv.md">Svenska</a> · <a href="README.ko.md">한국어</a>
</p>

<p align="center">
  <strong>आपके कोडिंग एजेंट्स का कंट्रोल रूम।</strong><br/>
  Claude Code, Codex, Gemini CLI और हर दूसरे CLI एजेंट को साथ-साथ चलाएँ — क्लाइंट और प्रोजेक्ट के हिसाब से व्यवस्थित, आपकी अपनी मशीन पर, आपके अपने सब्सक्रिप्शन के साथ।
</p>

<h3 align="center"><a href="https://github.com/shellonback/promptops/releases/latest"><ins>PromptOps Desktop डाउनलोड करें</ins></a></h3>

<p align="center">
  <picture><source media="(prefers-reduced-motion: reduce)" srcset="../../docs/assets/readme/seven-agents.jpg"><img src="../../docs/assets/readme/seven-agents.gif" alt="एक ही PromptOps सेशन में साथ-साथ काम करते सात एजेंट: एक प्रॉम्प्ट बॉक्स से खोला गया, पाँच को लीड एजेंट ने MCP के ज़रिए खोला" width="960" /></picture>
</p>

<p align="center">
  <sub>ओपन-सोर्स एडिशन का सोर्स कोड, बिना अकाउंट, बिना साइन-इन और बिना PromptOps सर्वर के, जल्द ही इस रिपॉज़िटरी में आ रहा है। PromptOps Desktop चलाने के लिए तैयार ऐप है, जिसमें Teams, सिंक और मोबाइल ऐप शामिल हैं। <a href="../../PRIVACY.md">आपकी मशीन से क्या बाहर जाता है →</a></sub>
</p>

## क्विक स्टार्ट

1. **[PromptOps Desktop डाउनलोड करें](https://github.com/shellonback/promptops/releases/latest)** या `npx @shellonback/promptops` चलाएँ।
2. **एक वर्कस्पेस जोड़ें**: वह प्रोजेक्ट फ़ोल्डर चुनें जिस पर आपके एजेंट काम करेंगे।
3. **एक सेशन शुरू करें** किसी ऐसे एजेंट CLI के साथ जिसे आप पहले से इस्तेमाल करते हैं (Claude Code, Codex, Gemini CLI…)। PromptOps इंस्टॉल किए गए CLI अपने-आप पहचान लेता है।
4. **उसे और एजेंट खोलने दें**: लीड एजेंट से कहें *"यहाँ 3 PromptOps एजेंट खोलो: एक टेस्ट के लिए, एक README के लिए, एक रिव्यू के लिए"*, और वे उसके बगल में दिखाई देंगे, हर एक अपने हिस्से पर। Claude Code और Codex को PromptOps MCP सर्वर अपने-आप मिल जाता है; हर दूसरा एजेंट अपने टर्मिनल में `promptops ctl` कमांड से यही कर सकता है।

## फ़ीचर्स

<table>
<tr>
<td width="50%" valign="middle">

### एजेंट जो एजेंट चलाते हैं

अपने लीड एजेंट से काम बाँटने को कहें: बिल्ट-इन MCP सर्वर के ज़रिए वह हर हिस्से के लिए एक एजेंट खोलता है, उनकी रिपोर्ट इकट्ठा करता है और काम को नए सेशन में ले जाता है। जोखिम भरी कार्रवाइयाँ आपकी मंज़ूरी के बिना नहीं होतीं।

</td>
<td width="50%">
  <picture><source media="(prefers-reduced-motion: reduce)" srcset="../../docs/assets/readme/agents-organize.jpg"><img src="../../docs/assets/readme/agents-organize.gif" alt="एक लीड एजेंट PromptOps MCP सर्वर के ज़रिए सहयोगी एजेंट खोलता है" width="100%" /></picture>
</td>
</tr>
<tr>
<td width="50%">
  <picture><source media="(prefers-reduced-motion: reduce)" srcset="../../docs/assets/readme/right-agent.jpg"><img src="../../docs/assets/readme/right-agent.gif" alt="अलग-अलग प्रोवाइडर और मॉडल के साथ सब-एजेंट शुरू करना" width="100%" /></picture>
</td>
<td width="50%" valign="middle">

### हर काम के लिए सही एजेंट

हर सब-एजेंट के लिए प्रोवाइडर, मॉडल और एफ़र्ट चुनें: रीफ़ैक्टर पर Claude, बंडल एनालिसिस पर Gemini, रिव्यू पर Codex — सब एक ही सेशन में। वर्किंग मोड (Sprint, Architect, Detective, Paranoid…) हर CLI के नेटिव फ़्लैग्स से मैप होते हैं।

</td>
</tr>
<tr>
<td width="50%" valign="middle">

### एक क्लिक में कमांड, सेशन जो बने रहते हैं

जब Claude कोई कमांड सुझाए, उसके बगल में प्ले दबाएँ: वह टर्मिनल में चलती है और एजेंट नतीजा पढ़ लेता है। ऐप बंद करके दोबारा खोलें — वही सेशन, वही एजेंट, वही जगह।

</td>
<td width="50%">
  <picture><source media="(prefers-reduced-motion: reduce)" srcset="../../docs/assets/readme/one-click-run.jpg"><img src="../../docs/assets/readme/one-click-run.gif" alt="सुझाई गई कमांड को एक क्लिक में चलाना, फिर सेशन को रीस्टोर करना" width="100%" /></picture>
</td>
</tr>
<tr>
<td width="50%">
  <picture><source media="(prefers-reduced-motion: reduce)" srcset="../../docs/assets/readme/floor-plan.jpg"><img src="../../docs/assets/readme/floor-plan.gif" alt="Floor Plan में क्लाइंट के हिसाब से समूहित एजेंट" width="100%" /></picture>
</td>
<td width="50%" valign="middle">

### Floor Plan

हर क्लाइंट, हर सेशन, एक ही फ़्लोर पर। जब कोई एजेंट काम पूरा करता है या उसे आपकी ज़रूरत होती है तो डेस्क जगमगा उठते हैं, और काम करते समय फ़्लोर 3D या 2D में आपके साथ रहता है।

</td>
</tr>
<tr>
<td width="50%" valign="middle">

### Token Efficiency Engine

जब किसी सब-एजेंट का प्रॉम्प्ट सिर्फ़ एक कमांड हो, तो PromptOps उसे सीधे टर्मिनल में चलाने का सुझाव देता है: तेज़, और कोई टोकन खर्च नहीं। हर सेशन असली टोकन उपयोग, कैश हिट और लागत दिखाता है, जो एजेंट के अपने ट्रांसक्रिप्ट से पढ़े जाते हैं।

</td>
<td width="50%">
  <picture><source media="(prefers-reduced-motion: reduce)" srcset="../../docs/assets/readme/token-efficiency.jpg"><img src="../../docs/assets/readme/token-efficiency.gif" alt="PromptOps टोकन खर्च करने के बजाय कमांड को सीधे टर्मिनल में चलाने का सुझाव देता है" width="100%" /></picture>
</td>
</tr>
<tr>
<td width="50%">
  <a href="https://www.promptoperations.ai/"><picture><source media="(prefers-reduced-motion: reduce)" srcset="../../docs/assets/readme/teams.jpg"><img src="../../docs/assets/readme/teams.gif" alt="PromptOps Desktop में Teams: वर्चुअल ऑफ़िस, चैट और बोर्ड" width="100%" /></picture></a>
</td>
<td width="50%" valign="middle">

### Teams <sub><kbd>PromptOps Desktop</kbd></sub>

आपकी टीम, आपके एजेंट्स के ठीक बगल में: वर्चुअल ऑफ़िस, चैट, प्रोजेक्ट बोर्ड और स्प्रिंट। किसी टास्क पर प्ले दबाएँ और आपके सेशन में एक एजेंट उसे उठा लेता है; टेस्ट पास होने पर उसे Done में खींच दें।

Teams को सर्वर चाहिए, इसलिए यह [PromptOps Desktop](https://www.promptoperations.ai/) में है, जो होस्टेड एडिशन है। ओपन-सोर्स एडिशन में यह लॉक के साथ दिखता है और कोई कोड नहीं चलाता।

</td>
</tr>
</table>

**साथ में यह भी:**

- **Session Vault** — सेशन, प्रॉम्प्ट, नोट्स और सेटिंग्स हर रिकॉर्ड के स्तर पर AES-256-GCM से एन्क्रिप्टेड, और की आपके OS कीचेन में।
- **प्रॉम्प्ट लाइब्रेरी** — वेरिएबल, कैटेगरी और टैग के साथ वर्ज़न किए गए प्रॉम्प्ट, किसी भी एजेंट से बस एक क्लिक दूर।
- **लोकल रूप से बनाए गए प्लगइन** — सैंडबॉक्स्ड प्लगइन होस्ट और Plugin Studio: किसी फ़ोल्डर में प्लगइन का ढाँचा बनाएँ, किसी एजेंट से उसे लिखवाएँ, और लाइव रीलोड करें। आधिकारिक कैटलॉग में पुल रिक्वेस्ट भेजकर उसे शेयर करें।
- **बिल्ट-इन डेव टूल्स** — Git एक्सप्लोरर और AI कमिट मैसेज, डेटाबेस एक्सप्लोरर, कोड एडिटर, Docker और पोर्ट्स पैनल, SSH टर्मिनल।
- **प्रोवाइडर लिमिट की चिंता नहीं** — जब कोई एजेंट अपने प्लान की लिमिट तक पहुँचता है, तो PromptOps दिखाता है कि कौन-से दूसरे इंस्टॉल किए गए CLI काम सँभाल सकते हैं, और एक क्लिक में स्विच कर देता है।
- **आपके डिवाइस पर वॉइस प्रॉम्प्ट** — लोकल Whisper ट्रांसक्रिप्शन; आपकी अपनी Groq या OpenAI की सिर्फ़ फ़ॉलबैक के तौर पर, अगर आप उसे जोड़ें।
- **उपयोग और स्पीड** — हर सेशन का टोकन उपयोग, और आपके पास उपलब्ध मॉडलों का साथ-साथ स्पीड टेस्ट।
- **नेटिव और हल्का** — नेटिव PTY के साथ Rust और Tauri 2। कोई बंडल किया गया Chromium नहीं।

---

## समर्थित एजेंट

**किसी भी CLI एजेंट** के साथ काम करता है — अगर वह टर्मिनल में चलता है, तो PromptOps में भी चलता है।

<p>
  <a href="https://docs.anthropic.com/en/docs/claude-code"><kbd><img src="../../docs/assets/providers/claude.svg" alt="" width="16" valign="middle" /> Claude Code</kbd></a> &nbsp;
  <a href="https://github.com/openai/codex"><kbd><img src="../../docs/assets/providers/openai.svg" alt="" width="16" valign="middle" /> Codex</kbd></a> &nbsp;
  <a href="https://github.com/google-gemini/gemini-cli"><kbd><img src="../../docs/assets/providers/gemini.svg" alt="" width="16" valign="middle" /> Gemini CLI</kbd></a> &nbsp;
  <a href="https://antigravity.google"><kbd><img src="../../docs/assets/providers/antigravity.svg" alt="" width="16" valign="middle" /> Antigravity</kbd></a> &nbsp;
  <a href="https://docs.github.com/en/copilot/how-tos/set-up/install-copilot-cli"><kbd><img src="../../docs/assets/providers/copilot.svg" alt="" width="16" valign="middle" /> GitHub Copilot</kbd></a> &nbsp;
  <a href="https://cursor.com/cli"><kbd><img src="../../docs/assets/providers/cursor.svg" alt="" width="16" valign="middle" /> Cursor</kbd></a> &nbsp;
  <a href="https://x.ai/cli"><kbd><img src="../../docs/assets/providers/grok.svg" alt="" width="16" valign="middle" /> Grok</kbd></a> &nbsp;
  <a href="https://dev.meta.ai/docs/muse-code"><kbd><img src="../../docs/assets/providers/muse.svg" alt="" width="16" valign="middle" /> Muse</kbd></a> &nbsp;
  <a href="https://hermes-agent.nousresearch.com/docs/"><kbd><img src="../../docs/assets/providers/hermes.svg" alt="" width="16" valign="middle" /> Hermes</kbd></a> &nbsp;
  <a href="https://docs.z.ai"><kbd><img src="../../docs/assets/providers/zai.svg" alt="" width="16" valign="middle" /> Z.AI</kbd></a> &nbsp;
  <a href="https://www.kimi.com/code"><kbd><img src="../../docs/assets/providers/kimi.svg" alt="" width="16" valign="middle" /> Kimi</kbd></a> &nbsp;
  <a href="https://opencode.ai/docs/cli/"><kbd><img src="../../docs/assets/providers/terminal.svg" alt="" width="16" valign="middle" /> OpenCode</kbd></a> &nbsp;
  <kbd><img src="../../docs/assets/providers/terminal.svg" alt="" width="16" valign="middle" /> PromptOps CLI</kbd> &nbsp;
  <kbd>+ कोई भी CLI एजेंट</kbd>
</p>

PromptOps आधिकारिक CLI को उन्हीं अकाउंट्स के साथ लॉन्च करता है जिनके लिए आप पहले से भुगतान करते हैं। कोई प्रॉक्सी नहीं, टोकन की कोई रीसेल नहीं: हर एजेंट अपनी शर्तों के तहत सीधे अपने प्रोवाइडर से बात करता है।

<sub>प्रोडक्ट के नाम और लोगो उनके मालिकों के हैं। PromptOps एक स्वतंत्र प्रोजेक्ट है, जो उनसे संबद्ध नहीं है और न ही उनके द्वारा समर्थित है।</sub>

कोई एजेंट नहीं मिला? नया प्रोवाइडर जोड़ना एक स्पष्ट रूप से परिभाषित बदलाव है — देखें [CONTRIBUTING.md](../../CONTRIBUTING.md)।

---

## इंस्टॉल

### PromptOps Desktop — चलाने के लिए तैयार

macOS, Windows और Linux। इसमें Teams, डिवाइसों के बीच सिंक, मोबाइल ऐप और SSO शामिल हैं, और इसके लिए अकाउंट चाहिए।

- **[GitHub Releases से डाउनलोड करें](https://github.com/shellonback/promptops/releases/latest)**, macOS पर notarized।
- या, Node.js 18 या नए वर्ज़न के साथ: `npx @shellonback/promptops`। यह PromptOps Desktop को इंस्टॉल करके खोलता है, और ऐसा कोई भी डाउनलोड अस्वीकार कर देता है जो PromptOps रिलीज़ की से साइन न हो।

यह आपके सेशन डेटा को उसी एल्गोरिदम से एन्क्रिप्ट करता है जो ओपन-सोर्स एडिशन में है; फ़र्क यह है कि की हमारे सर्वरों के पास रहती है, ताकि आपके सेशन आपके साथ चल सकें। देखें [PRIVACY.md](../../PRIVACY.md#promptops-desktop-the-hosted-edition)।

### ओपन-सोर्स एडिशन

न अकाउंट, न सर्वर: सब कुछ आपके कंप्यूटर पर रहता है। इसका सोर्स कोड इस रिपॉज़िटरी में आ रहा है, साथ में macOS, Windows और Linux पर इसे खुद बिल्ड करने की कमांड्स भी। यह कब आता है जानने के लिए रिपॉज़िटरी को [Star](https://github.com/shellonback/promptops) करें।

---

## कम्युनिटी &amp; सपोर्ट

- **फ़ीडबैक &amp; आइडिया:** कुछ कमी लग रही है? [एक issue खोलें](https://github.com/shellonback/promptops/issues)।
- **Telegram:** रिलीज़, एक्सपेरिमेंट और अर्ली एक्सेस [t.me/promptoperations](https://t.me/promptoperations) पर।
- **प्राइवेसी:** ओपन-सोर्स एडिशन में कोई टेलीमेट्री नहीं, कोई एनालिटिक्स नहीं और कोई अपडेट चेक नहीं। PromptOps Desktop के लिए अकाउंट चाहिए और यह PromptOps सर्वरों से बात करता है। [PRIVACY.md](../../PRIVACY.md) बताता है कि हर एडिशन क्या भेजता है और कहाँ।
- **सिक्योरिटी:** कमज़ोरियों की रिपोर्ट निजी तौर पर करें, जैसा [SECURITY.md](../../SECURITY.md) में बताया गया है।
- **ओपन सोर्स और होस्टेड:** यहाँ क्या है, किसके लिए PromptOps Desktop चाहिए, और फ़ैसला कौन करता है: [GOVERNANCE.md](../../GOVERNANCE.md)।
- **सपोर्ट दिखाएँ:** अपडेट पाते रहने के लिए रिपॉज़िटरी को [Star](https://github.com/shellonback/promptops) करें।

---

## डेवलपमेंट

योगदान देना चाहते हैं? देखें [CONTRIBUTING.md](../../CONTRIBUTING.md)। कमिट्स पर sign-off होता है ([DCO](https://developercertificate.org/))।

<a href="https://github.com/shellonback/promptops/graphs/contributors">
  <img src="https://contrib.rocks/image?repo=shellonback/promptops" alt="PromptOps के योगदानकर्ता" />
</a>

## भाषाएँ

[English](../../README.md), [Italiano](README.it.md), [Français](README.fr.md), [Español](README.es.md), [Deutsch](README.de.md), [Português](README.pt.md), [中文](README.zh.md), [日本語](README.ja.md), [Русский](README.ru.md), [العربية](README.ar.md), **हिन्दी**, [Polski](README.pl.md), [Nederlands](README.nl.md), [Svenska](README.sv.md) और [한국어](README.ko.md), नीचे की बार से बदली जा सकती हैं।

## लाइसेंस

PromptOps [Apache License 2.0](../../LICENSE) के तहत मुफ़्त और ओपन सोर्स है।

"PromptOps" और PromptOps लोगो Shellonback S.r.l. के ट्रेडमार्क हैं — देखें [TRADEMARK.md](../../TRADEMARK.md)।
