# TXT Vault — منصة تعليمية عربية (Supabase + تيليجرام)

HTML/CSS/JS عادي بدون أدوات بناء، وقاعدة بيانات وصلاحيات على Supabase.

## هيكل المشروع

```
TXT-Vault/
├── index.html  login.html  register.html  student.html  admin.html
├── supabase.js                      ← إعداد الاتصال (URL + anon key)
├── CSS/   style.css  login.css  animations.css
├── JS/    auth.js  ui.js  animations.js  login.js  register.js  student.js  admin.js
├── sql/schema.sql                   ← الجداول + RLS + الدوال + بيانات أولية
└── supabase/functions/
    ├── telegram-webhook/index.ts    ← البوت: ربط الحساب + توثيق الهاتف + متابعة القناة
    └── check-membership/index.ts    ← التحقق من الاشتراك من الخادم
```

## خطوات التشغيل

### 1) Supabase
1. أنشئ مشروعًا على supabase.com.
2. من **SQL Editor** الصق محتوى `sql/schema.sql` كاملًا ونفّذه.
3. من **Project Settings → API** انسخ `Project URL` و `anon public key` وضعهما في `supabase.js`.
   **لا تضع `service_role` في أي ملف من ملفات الموقع.**
4. من **Authentication → Providers → Email**: لو فعّلت «Confirm email» سيصل الطالب رسالة تأكيد. للتجربة المحلية يمكنك إيقافها.
5. من **Authentication → URL Configuration** أضف عنوان موقعك المحلي (مثل `http://127.0.0.1:5500`) في Redirect URLs.

### 2) حساب المشرف
1. أنشئ حسابك من `register.html` كأي مستخدم.
2. في SQL Editor نفّذ (بعد تعديل البريد):
```sql
insert into public.app_admins (user_id)
select id from auth.users where email = 'YOUR_EMAIL@example.com'
on conflict do nothing;
```
3. سجّل الدخول من `login.html` وسيفتح `admin.html` تلقائيًا.

### 3) بوت تيليجرام والقناة
1. من **@BotFather** أنشئ بوتًا (`/newbot`) واحتفظ بالتوكن، وضع اسم البوت (بدون @) ورابط القناة في `supabase.js`.
2. أضف البوت **مشرفًا (Admin)** في القناة — شرط لازم ليستطيع فحص الأعضاء.
3. معرّف القناة: للقناة العامة استخدم `@channel_username`، وللخاصة استخدم الرقم `-100xxxxxxxxxx`.
4. ثبّت Supabase CLI ثم:
```bash
supabase login
supabase link --project-ref YOUR_PROJECT_REF
supabase secrets set TELEGRAM_BOT_TOKEN=123:ABC TELEGRAM_CHANNEL_ID=@your_channel TELEGRAM_WEBHOOK_SECRET=اختر_نصا_عشوائيا_طويلا
supabase functions deploy telegram-webhook --no-verify-jwt
supabase functions deploy check-membership
```
5. اربط الـ webhook بالبوت (استبدل القيم):
```bash
curl -X POST "https://api.telegram.org/botTOKEN/setWebhook" \
  -d "url=https://YOUR_PROJECT_REF.supabase.co/functions/v1/telegram-webhook" \
  -d "secret_token=نفس_قيمة_TELEGRAM_WEBHOOK_SECRET" \
  -d 'allowed_updates=["message","chat_member"]'
```
`chat_member` هو ما يجعل خروج الطالب من القناة يُكتشف فورًا.

### 4) تشغيل الموقع محليًا
الملفات تستخدم ES Modules فلا تعمل بالضغط المزدوج (file://). في VS Code ثبّت إضافة **Live Server** وافتح `index.html` بـ Go Live، أو:
```bash
npx serve .
```

## دورة الطالب
1. يسجّل حسابه ← الحالة `pending`.
2. من `student.html` يضغط «ربط تيليجرام» ← يفتح البوت ويضغط Start.
3. يشترك في القناة ويضغط «تحقق الآن» (الفحص يتم من الخادم عبر `getChatMember`).
4. يشارك رقمه من البوت بزر «مشاركة رقم الهاتف» (يُرفض أي رقم لا يخص صاحب الحساب نفسه).
5. المشرف يوافق من `admin.html`.
6. يفتح المحتوى الخاص بصفه والفصول المسموحة له فقط.

لو الطالب غادر القناة: تُسحب صلاحية القراءة تلقائيًا (RLS) حتى يشترك من جديد.

## الأمان (ما الذي يحميك فعلًا)
- RLS مفعّل على كل الجداول؛ الطالب لا يملك أي سياسة كتابة على `student_profiles` أو `telegram_links`، فلا يستطيع تغيير صفه أو حالته أو توثيق نفسه.
- قراءة `learning_content` تمر على دالة `can_read_section()` عند كل طلب: موافق عليه + اشتراك القناة + هاتف موثّق + الفصل مسموح له + نفس الصف.
- حالة الاشتراك تُكتب فقط من Edge Functions بمفتاح `service_role` (يعيش في الخادم فقط).
- أي فحص بالاشتراك يُعتبر صالحًا ١٢ ساعة (ويُجدَّد تلقائيًا عند فتح صفحة الطالب)، وخروج الطالب من القناة يُلتقط فورًا عبر `chat_member`.
- إخفاء الأزرار في الواجهة تجميل فقط — الحماية في قاعدة البيانات.
- إذا ظهرت أخطاء في المحتوى بعد تغيير الصلاحيات، اضغط «تحقق الآن» في صفحة الطالب.

## ملاحظات
- ملفات TXT تُخزَّن نصًّا في قاعدة البيانات (حد الرفع في لوحة الإدارة 2MB للملف).
- PDF والفيديو تُضاف كروابط (تيليجرام أو تخزين خارجي). الفيديوهات الكبيرة (أكبر من 6GB) تحتاج تخزينًا خارجيًا.
- الروابط الخارجية نفسها محمية بقراءة الجدول فقط؛ الرابط في حد ذاته يعتمد على حماية الخدمة التي يشير إليها.
- إضافة مادة جديدة غير JavaScript/Python: عدّل قيد `subject` في `schema.sql` والمصفوفة `SUBJECTS` في `supabase.js`.
