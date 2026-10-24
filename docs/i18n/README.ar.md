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
  <a href="../../README.md">English</a> · <a href="README.it.md">Italiano</a> · <a href="README.fr.md">Français</a> · <a href="README.es.md">Español</a> · <a href="README.de.md">Deutsch</a> · <a href="README.pt.md">Português</a> · <a href="README.zh.md">中文</a> · <a href="README.ja.md">日本語</a> · <a href="README.ru.md">Русский</a> · <b>العربية</b> · <a href="README.hi.md">हिन्दी</a> · <a href="README.pl.md">Polski</a> · <a href="README.nl.md">Nederlands</a> · <a href="README.sv.md">Svenska</a> · <a href="README.ko.md">한국어</a>
</p>

<p align="center">
  <strong>بيئة ADE متعددة المشاريع والجلسات لوكلاء البرمجة بالذكاء الاصطناعي عبر CLI.</strong><br/>
  شغّل Claude Code وCodex وGemini CLI وأي وكيل CLI آخر جنبًا إلى جنب، منظمة حسب العميل والمشروع والجلسة، على جهازك وباشتراكاتك الخاصة.
</p>

<h3 align="center"><a href="https://github.com/shellonback/promptops/releases/latest"><ins>نزّل PromptOps Desktop</ins></a></h3>

<p align="center">
  <picture><source media="(prefers-reduced-motion: reduce)" srcset="../../docs/assets/readme/seven-agents.jpg"><img src="../../docs/assets/readme/seven-agents.gif" alt="سبعة وكلاء يعملون جنبًا إلى جنب في جلسة PromptOps واحدة: واحد فُتح من مربع الأوامر، وخمسة فتحها الوكيل الرئيسي عبر MCP" width="960" /></picture>
</p>

<p align="center">
  <sub>الشيفرة المصدرية للإصدار مفتوح المصدر، بلا حساب ولا تسجيل دخول ولا خادم PromptOps، قادمة إلى هذا المستودع. أما PromptOps Desktop فهو التطبيق الجاهز للتشغيل، مع Teams والمزامنة وتطبيق الهاتف. <a href="../../PRIVACY.md">ما الذي يغادر جهازك →</a></sub>
</p>

## البدء السريع

1. **[نزّل PromptOps Desktop](https://github.com/shellonback/promptops/releases/latest)** أو شغّل `npx @shellonback/promptops`.
2. **أضف مساحة عمل**: اختر مجلد المشروع الذي سيعمل عليه وكلاؤك.
3. **ابدأ جلسة** باستخدام وكيل CLI تستخدمه بالفعل (Claude Code وCodex وGemini CLI…). يكتشف PromptOps الوكلاء المثبّتين تلقائيًا.
4. **دعه يفتح وكلاء آخرين**: اطلب من الوكيل الرئيسي *"افتح هنا 3 وكلاء PromptOps: واحد للاختبارات، وواحد لملف README، وواحد للمراجعة"*، فيظهرون بجانبه، كلٌّ يعمل على جزئه. يحصل Claude Code وCodex على خادم MCP الخاص بـ PromptOps تلقائيًا؛ ويستطيع أي وكيل آخر فعل الشيء نفسه عبر الأمر `promptops ctl` في الطرفية الخاصة به.

## الميزات

<table>
<tr>
<td width="50%" valign="middle">

### وكلاء يديرون وكلاء

اطلب من وكيلك الرئيسي تقسيم العمل: عبر خادم MCP المدمج يفتح وكيلًا لكل جزء، ويجمع تقاريرهم، وينقل العمل إلى جلسة جديدة. وتبقى الإجراءات الحساسة رهن موافقتك.

</td>
<td width="50%">
  <picture><source media="(prefers-reduced-motion: reduce)" srcset="../../docs/assets/readme/agents-organize.jpg"><img src="../../docs/assets/readme/agents-organize.gif" alt="وكيل رئيسي يفتح وكلاء شقيقين عبر خادم MCP الخاص بـ PromptOps" width="100%" /></picture>
</td>
</tr>
<tr>
<td width="50%">
  <picture><source media="(prefers-reduced-motion: reduce)" srcset="../../docs/assets/readme/right-agent.jpg"><img src="../../docs/assets/readme/right-agent.gif" alt="إنشاء وكلاء فرعيين بمزوّدين ونماذج مختلفة" width="100%" /></picture>
</td>
<td width="50%" valign="middle">

### الوكيل المناسب لكل مهمة

اختر المزوّد والنموذج ومستوى الجهد لكل وكيل فرعي: Claude لإعادة الهيكلة، وGemini لتحليل الحزمة، وCodex للمراجعة، وكل ذلك في جلسة واحدة. وتُترجَم أوضاع العمل (Sprint وArchitect وDetective وParanoid…) إلى الخيارات الأصلية لكل CLI.

</td>
</tr>
<tr>
<td width="50%" valign="middle">

### أوامر بنقرة واحدة، وجلسات لا تضيع

عندما يقترح Claude أمرًا، اضغط زر التشغيل بجانبه: يُنفَّذ في الطرفية ويقرأ الوكيل النتيجة. أغلق التطبيق وأعد فتحه، فتجد الجلسات نفسها والوكلاء أنفسهم في المكان نفسه.

</td>
<td width="50%">
  <picture><source media="(prefers-reduced-motion: reduce)" srcset="../../docs/assets/readme/one-click-run.jpg"><img src="../../docs/assets/readme/one-click-run.gif" alt="تشغيل أمر مقترح بنقرة واحدة، ثم استعادة الجلسة" width="100%" /></picture>
</td>
</tr>
<tr>
<td width="50%">
  <picture><source media="(prefers-reduced-motion: reduce)" srcset="../../docs/assets/readme/floor-plan.jpg"><img src="../../docs/assets/readme/floor-plan.gif" alt="Floor Plan يعرض الوكلاء مجمّعين حسب العميل" width="100%" /></picture>
</td>
<td width="50%" valign="middle">

### Floor Plan

كل عميل وكل جلسة في طابق واحد. تضيء المكاتب عندما ينهي وكيلٌ عمله أو يحتاج إليك، ويبقى الطابق بجانبك، بالأبعاد الثلاثية أو الثنائية، أثناء عملك.

</td>
</tr>
<tr>
<td width="50%" valign="middle">

### Token Efficiency Engine

عندما يكون طلب الوكيل الفرعي مجرد أمر، يقترح PromptOps تشغيله مباشرة في الطرفية: أسرع ومن دون استهلاك رموز. وتعرض كل جلسة الاستهلاك الحقيقي للرموز وإصابات الذاكرة المؤقتة والتكلفة، مقروءة من سجل الوكيل نفسه.

</td>
<td width="50%">
  <picture><source media="(prefers-reduced-motion: reduce)" srcset="../../docs/assets/readme/token-efficiency.jpg"><img src="../../docs/assets/readme/token-efficiency.gif" alt="يقترح PromptOps تشغيل أمر مباشرة في الطرفية بدلًا من استهلاك الرموز" width="100%" /></picture>
</td>
</tr>
<tr>
<td width="50%">
  <a href="https://www.promptoperations.ai/"><picture><source media="(prefers-reduced-motion: reduce)" srcset="../../docs/assets/readme/teams.jpg"><img src="../../docs/assets/readme/teams.gif" alt="Teams في PromptOps Desktop: مكتب افتراضي ودردشة ولوحات" width="100%" /></picture></a>
</td>
<td width="50%" valign="middle">

### Teams <sub><kbd>PromptOps Desktop</kbd></sub>

فريقك إلى جانب وكلائك مباشرة: مكتب افتراضي، ودردشة، ولوحات مشاريع، وسبرنتات. اضغط زر التشغيل على مهمة فيتولّاها وكيل في جلستك؛ واسحبها إلى Done عندما تنجح الاختبارات.

تحتاج Teams إلى خادم، لذا فهي متوفرة في [PromptOps Desktop](https://www.promptoperations.ai/)، الإصدار المستضاف. وفي الإصدار مفتوح المصدر تظهر بقفل ولا تشغّل أي شيفرة.

</td>
</tr>
</table>

**وأيضًا ضمن الحزمة:**

- **Session Vault** — الجلسات والأوامر والملاحظات والإعدادات مشفّرة سجلًّا بسجل باستخدام AES-256-GCM، والمفتاح في سلسلة مفاتيح نظام التشغيل لديك.
- **مكتبة الأوامر** — أوامر بإصدارات متعددة مع متغيرات وفئات ووسوم، على بُعد نقرة واحدة من أي وكيل.
- **إضافات تبنيها محليًا** — مضيف إضافات معزول وPlugin Studio: أنشئ هيكل إضافة في مجلد، ودع وكيلًا يكتبها، وأعد تحميلها مباشرة. شاركها عبر طلب سحب (pull request) إلى الكتالوج الرسمي.
- **أدوات تطوير مدمجة** — مستكشف Git ورسائل commit بالذكاء الاصطناعي، ومستكشف قواعد بيانات، ومحرر شيفرة، ولوحات Docker والمنافذ، وطرفيات SSH.
- **حدود المزوّدين تحت السيطرة** — عندما يبلغ وكيلٌ حدّ خطته، يعرض PromptOps أيّ أدوات CLI مثبّتة أخرى يمكنها تولّي العمل، ويبدّل إليها بنقرة واحدة.
- **أوامر صوتية على جهازك** — تفريغ صوتي محلي عبر Whisper؛ ومفتاح Groq أو OpenAI الخاص بك كخيار احتياطي فقط، إن أضفته.
- **الاستهلاك والسرعة** — استهلاك الرموز (tokens) لكل جلسة، واختبار سرعة جنبًا إلى جنب للنماذج المتاحة لك.
- **أصلي وخفيف** — Rust وTauri 2 مع PTY أصلي. بلا Chromium مضمّن.

---

## الوكلاء المدعومون

يعمل مع **أي وكيل CLI**: إن كان يعمل في طرفية، فهو يعمل في PromptOps.

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
  <kbd>+ أي وكيل CLI</kbd>
</p>

يشغّل PromptOps أدوات CLI الرسمية بالحسابات التي تدفع لها بالفعل. لا وسيط (proxy) ولا إعادة بيع للرموز: كل وكيل يتواصل مع مزوّده الخاص، وفق شروطه الخاصة.

<sub>أسماء المنتجات وشعاراتها مملوكة لأصحابها. PromptOps مشروع مستقل، غير تابع لهم ولا معتمَد منهم.</sub>

هل ينقصك وكيل؟ إضافة مزوّد تغييرٌ محدّد المعالم — راجع [CONTRIBUTING.md](../../CONTRIBUTING.md).

---

## التثبيت

### PromptOps Desktop — جاهز للتشغيل

macOS وWindows وLinux. يتضمن Teams والمزامنة بين الأجهزة وتطبيق الهاتف وSSO، ويتطلب حسابًا.

- **[نزّله من GitHub Releases](https://github.com/shellonback/promptops/releases/latest)**، موثَّق (notarized) على macOS.
- أو، باستخدام Node.js 18 أو أحدث: `npx @shellonback/promptops`. يثبّت PromptOps Desktop ويفتحه، ويرفض أي تنزيل غير موقَّع بمفتاح إصدار PromptOps.

يشفّر بيانات جلساتك بالخوارزمية نفسها المستخدمة في الإصدار مفتوح المصدر؛ والفرق أن المفتاح محفوظ لدى خوادمنا، لكي تتبعك جلساتك أينما كنت. راجع [PRIVACY.md](../../PRIVACY.md#promptops-desktop-the-hosted-edition).

### الإصدار مفتوح المصدر

بلا حساب وبلا خادم: يبقى كل شيء على حاسوبك. شيفرته المصدرية قادمة إلى هذا المستودع، مع الأوامر اللازمة لبنائه بنفسك على macOS وWindows وLinux. [ضع نجمة](https://github.com/shellonback/promptops) على المستودع لتعرف موعد وصوله.

---

## المجتمع &amp; الدعم

- **الملاحظات &amp; الأفكار:** ينقصك شيء؟ [افتح issue](https://github.com/shellonback/promptops/issues).
- **Telegram:** الإصدارات والتجارب والوصول المبكر على [t.me/promptoperations](https://t.me/promptoperations).
- **الخصوصية:** الإصدار مفتوح المصدر بلا قياس عن بُعد (telemetry)، وبلا تحليلات، وبلا فحص للتحديثات. أما PromptOps Desktop فيتطلب حسابًا ويتواصل مع خوادم PromptOps. يوضّح [PRIVACY.md](../../PRIVACY.md) ما يرسله كل إصدار وإلى أين.
- **الأمان:** أبلغ عن الثغرات بشكل خاص، كما هو موضّح في [SECURITY.md](../../SECURITY.md).
- **مفتوح المصدر ومستضاف:** ما الموجود هنا، وما الذي يتطلب PromptOps Desktop، ومن يقرّر: [GOVERNANCE.md](../../GOVERNANCE.md).
- **أظهر دعمك:** [ضع نجمة](https://github.com/shellonback/promptops) على المستودع لتتابع المستجدات.

---

## التطوير

تريد المساهمة؟ راجع [CONTRIBUTING.md](../../CONTRIBUTING.md). تُوقَّع الـ commits بإقرار المساهمة ([DCO](https://developercertificate.org/)).

<a href="https://github.com/shellonback/promptops/graphs/contributors">
  <img src="https://contrib.rocks/image?repo=shellonback/promptops" alt="المساهمون في PromptOps" />
</a>

## اللغات

[English](../../README.md), [Italiano](README.it.md), [Français](README.fr.md), [Español](README.es.md), [Deutsch](README.de.md), [Português](README.pt.md), [中文](README.zh.md), [日本語](README.ja.md), [Русский](README.ru.md), **العربية**, [हिन्दी](README.hi.md), [Polski](README.pl.md), [Nederlands](README.nl.md), [Svenska](README.sv.md) و [한국어](README.ko.md)، ويمكن التبديل بينها من الشريط السفلي.

## الترخيص

PromptOps مجاني ومفتوح المصدر بموجب [Apache License 2.0](../../LICENSE).

"PromptOps" وشعار PromptOps علامتان تجاريتان لشركة Shellonback S.r.l. — راجع [TRADEMARK.md](../../TRADEMARK.md).
