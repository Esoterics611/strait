import {
  createContext,
  createElement,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import type { Money } from './contract';

export type Lang = 'en' | 'he';
export type Dir = 'ltr' | 'rtl';

const STORAGE_KEY = 'lb.lang';

// English is the source of truth for the key set; `he` must match it exactly
// (enforced by the Record<MsgKey, string> type below).
const en = {
  // shell / nav
  'app.name': 'Lira-Bridge',
  'nav.home': 'Home',
  'nav.send': 'Send',
  'nav.activity': 'Activity',
  'nav.recipients': 'Recipients',
  'nav.profile': 'Profile',
  'lang.toggle': 'עברית',
  'action.continue': 'Continue',
  'action.back': 'Back',
  'action.retry': 'Try again',
  'action.cancel': 'Cancel',
  'action.save': 'Save',
  'action.getHelp': 'Get help',
  'action.signOut': 'Sign out',
  'common.loading': 'Loading…',
  'common.somethingWrong': 'Something went wrong.',
  'common.copied': 'Copied',
  'common.copy': 'Copy',
  'common.reference': 'Reference {id}',

  // landing
  'landing.headline': 'Send money to the US — they get every dollar you’d expect.',
  'landing.cta': 'Send money',
  'landing.signin': 'Sign in',
  'landing.trust.regulated': 'Regulated remitter',
  'landing.trust.fee': 'Transparent fee',
  'landing.trust.tracking': 'Live tracking',
  'landing.offline': 'You’re offline — we’ll reconnect.',

  // auth
  'auth.title': 'Sign in or create an account',
  'auth.channel.email': 'Email',
  'auth.channel.sms': 'SMS',
  'auth.address.email': 'Email address',
  'auth.address.sms': 'Phone number',
  'auth.sendCode': 'Send code',
  'auth.sending': 'Sending…',
  'auth.codeSent': 'Code sent to {addr}',
  'auth.enterCode': 'Enter the 6-digit code',
  'auth.verify': 'Verify',
  'auth.verifying': 'Verifying…',
  'auth.resendIn': 'Resend in {sec}',
  'auth.resend': 'Resend code',
  'auth.err.badCode': 'That code didn’t match. {left} tries left.',
  'auth.err.expired': 'That code expired. Request a new one.',
  'auth.err.locked': 'Too many attempts. Try again in {sec}.',
  'auth.devHint': 'Dev mode: the code is {code}',

  // profile
  'profile.title': 'A few details',
  'profile.displayName': 'Your name',
  'profile.country': 'Country',
  'profile.phone': 'Phone',
  'profile.email': 'Email',
  'profile.address': 'Address',
  'profile.address.street': 'Street',
  'profile.address.city': 'City',
  'profile.address.postal': 'Postal code',
  'profile.kyc.disclosureTitle': 'Why we’ll ask for ID later',
  'profile.kyc.disclosure':
    'We’ll ask for ID later, only if a transfer needs it. You can start now.',
  'profile.saving': 'Saving…',
  'profile.language': 'Language',
  'profile.kycStatus': 'Verification status',
  'profile.kyc.NONE': 'Not needed yet',
  'profile.kyc.PENDING': 'In review',
  'profile.kyc.VERIFIED': 'Verified',
  'profile.kyc.REJECTED': 'Needs attention',
  'profile.verifyNow': 'Verify now',

  // home
  'home.greeting': 'Hi{name}',
  'home.send': 'Send money',
  'home.sendAgain': 'Send again',
  'home.recentActivity': 'Recent activity',
  'home.noTransfers': 'No transfers yet. Sending takes about a minute.',
  'home.noRecipients': 'Add your first recipient',
  'home.kycNudge': 'A verification step is coming up soon. Tap to learn why.',
  'home.activityFailed': 'Couldn’t load activity.',

  // recipients
  'rcpt.title': 'Recipients',
  'rcpt.add': 'Add recipient',
  'rcpt.addFirst': 'Add your first recipient',
  'rcpt.empty': 'No recipients yet.',
  'rcpt.displayName': 'Recipient’s name',
  'rcpt.relationship': 'Relationship (optional)',
  'rcpt.payoutMethod': 'How they receive it',
  'rcpt.bank.account': 'Account number',
  'rcpt.bank.routing': 'Routing number',
  'rcpt.bank.type': 'Account type',
  'rcpt.bank.checking': 'Checking',
  'rcpt.bank.savings': 'Savings',
  'rcpt.trust':
    'Bank details are encrypted and tokenized — we never store your recipient’s full account number.',
  'rcpt.submitting': 'Setting up…',
  'rcpt.registering': 'Setting up {name} with our payout partner — usually under a minute. You can keep going.',
  'rcpt.ready': '{name} is ready',
  'rcpt.failed': 'We couldn’t set up {name}.',
  'rcpt.duplicate': 'You already have {name} with this account.',
  'rcpt.editBankWarn':
    'This re-verifies the recipient and pauses transfers to them until ready.',
  'rcpt.maskedTo': 'to ••••{last4}',
  'rcpt.err.routing': 'Enter a valid 9-digit routing number.',
  'rcpt.err.account': 'Enter the account number.',
  'rcpt.err.name': 'Enter the recipient’s name.',

  // pay methods
  'payout.BANK_RTP': 'Instant',
  'payout.BANK_FEDNOW': 'Instant',
  'payout.BANK_ACH': 'Standard',
  'payin.MESH': 'Crypto wallet / exchange',
  'payin.ONRAMP': 'Bank transfer (shekels)',
  'payin.IL_BANK': 'Israeli bank wire',

  // wizard
  'wiz.step': 'Step {n} of 5',
  'wiz.step.recipient': 'Recipient',
  'wiz.step.amount': 'Amount',
  'wiz.step.payin': 'Pay-in',
  'wiz.step.payout': 'Delivery',
  'wiz.step.review': 'Review',
  'wiz.recipient.pick': 'Who are you sending to?',
  'wiz.recipient.addNew': 'Add new recipient',
  'wiz.recipient.search': 'Search recipients',
  'wiz.recipient.settingUp':
    'Setting up — you can continue, we’ll be ready before money moves.',
  'wiz.recipient.fix': 'Fix recipient',
  'wiz.amount.label': 'You send',
  'wiz.amount.belowFloor': 'Minimum send is about {amt} ($1.00 to deliver).',
  'wiz.amount.quoteErr': 'Couldn’t get a rate — retry',
  'wiz.payin.title': 'How will you pay?',
  'wiz.payout.title': 'How should they receive it?',
  'wiz.payout.instant': 'Arrives in minutes.',
  'wiz.payout.standard': '1–3 business days, lower fee.',
  'wiz.payout.recommended': 'Recommended',
  'wiz.payout.achOnly': 'This recipient’s bank supports standard only.',
  'wiz.review.title': 'Review & send',
  'wiz.review.confirm': 'Confirm & send {total}',
  'wiz.review.confirming': 'Sending…',
  'wiz.review.to': 'To',
  'wiz.review.via': 'Pay-in',
  'wiz.review.delivery': 'Delivery',
  'wiz.review.rateLocks': 'Rate locks at review',
  'wiz.review.expiresIn': 'Rate locked · {sec}',
  'wiz.review.expired': 'Rate updated — review the new total.',
  'wiz.review.reaccept': 'Use new rate',
  'wiz.review.recipientNotReady':
    'We’ll set up {name} before money moves — continue?',

  // summary rail
  'rail.youSend': 'You send',
  'rail.fee': 'Fee',
  'rail.rate': 'Rate',
  'rail.theyGet': 'They get',
  'rail.arrives': 'Arrives',
  'rail.rateValue': '1 ₪ = {usd}',

  // pay-in execution
  'fund.title': 'Complete your payment',
  'fund.track': 'Track this transfer',
  'fund.mesh.title': 'Connect your wallet or exchange',
  'fund.mesh.body': 'We’ll take it from here once your transfer confirms on-chain.',
  'fund.mesh.connect': 'Connect',
  'fund.onramp.title': 'Send a bank transfer',
  'fund.onramp.next': 'What happens next',
  'fund.onramp.step1': 'Transfer the exact amount to the account below.',
  'fund.onramp.step2': 'Include the reference so we can match it.',
  'fund.onramp.step3': 'No manual confirmation — we react to the wire automatically.',
  'fund.onramp.bank': 'Bank',
  'fund.onramp.account': 'Account number',
  'fund.onramp.reference': 'Reference',
  'fund.ilbank.title': 'Send an Israeli bank wire',
  'fund.ilbank.beneficiary': 'Beneficiary',
  'fund.ilbank.iban': 'IBAN',
  'fund.ilbank.reference': 'Reference',
  'fund.ilbank.window': 'Please send within 72 hours.',

  // tracking
  'track.title': 'Tracking',
  'track.now': 'Now: {stage}',
  'track.eta': 'Arrives by {date}',
  'track.settlement': 'Settlement detail',
  'track.bridgeId': 'Bridge transfer ID',
  'track.rail': 'Rail',
  'track.settledAt': 'Settled at',
  'track.saveReceipt': 'Save receipt',
  'track.lastUpdate': 'Working on it — last update {rel}',
  'track.recipientSetup': 'Setting up {name}',
  'track.delivered': 'Delivered {amt} to {name}',
  'track.sendAgain': 'Send again',
  'track.fail.preDispatch':
    'This transfer didn’t go through. Your {total} was not taken.',
  'track.fail.bridge':
    'We couldn’t deliver to {name}. You’ll get {total} back by {date}. Nothing for you to do.',
  'track.reversing':
    'Returning your {total} — by {date}. Nothing to do.',
  'track.refunded': 'Your {total} has been returned.',
  'track.ach': 'Arrives by {date} (slower bank rail).',

  // activity
  'activity.title': 'Activity',
  'activity.search': 'Search by recipient',
  'activity.empty': 'No transfers yet.',
  'activity.loadMore': 'Load more',
  'activity.row': '{send} to {name}, {status}, {rel}',
  'activity.receipt': 'Receipt',
  'activity.timeline': 'Timeline',

  // connection
  'conn.connecting': 'Connecting…',
  'conn.live': 'Live',
  'conn.reconnecting': 'Reconnecting…',
  'conn.closed': 'Offline',
} as const;

export type MsgKey = keyof typeof en;
export type Vars = Record<string, string | number>;

const he: Record<MsgKey, string> = {
  'app.name': 'לִירָה-בְּרִידְג׳',
  'nav.home': 'בית',
  'nav.send': 'שליחה',
  'nav.activity': 'פעילות',
  'nav.recipients': 'נמענים',
  'nav.profile': 'פרופיל',
  'lang.toggle': 'English',
  'action.continue': 'המשך',
  'action.back': 'חזרה',
  'action.retry': 'נסו שוב',
  'action.cancel': 'ביטול',
  'action.save': 'שמירה',
  'action.getHelp': 'קבלת עזרה',
  'action.signOut': 'התנתקות',
  'common.loading': 'טוען…',
  'common.somethingWrong': 'משהו השתבש.',
  'common.copied': 'הועתק',
  'common.copy': 'העתק',
  'common.reference': 'מספר אסמכתא {id}',

  'landing.headline': 'שלחו כסף לארה״ב — הם מקבלים בדיוק מה שמגיע.',
  'landing.cta': 'שליחת כסף',
  'landing.signin': 'התחברות',
  'landing.trust.regulated': 'מעביר כספים מפוקח',
  'landing.trust.fee': 'עמלה שקופה',
  'landing.trust.tracking': 'מעקב בזמן אמת',
  'landing.offline': 'אתם במצב לא מקוון — נתחבר מחדש.',

  'auth.title': 'התחברות או יצירת חשבון',
  'auth.channel.email': 'אימייל',
  'auth.channel.sms': 'SMS',
  'auth.address.email': 'כתובת אימייל',
  'auth.address.sms': 'מספר טלפון',
  'auth.sendCode': 'שליחת קוד',
  'auth.sending': 'שולח…',
  'auth.codeSent': 'קוד נשלח אל {addr}',
  'auth.enterCode': 'הזינו את הקוד בן 6 הספרות',
  'auth.verify': 'אימות',
  'auth.verifying': 'מאמת…',
  'auth.resendIn': 'שליחה חוזרת בעוד {sec}',
  'auth.resend': 'שליחת קוד מחדש',
  'auth.err.badCode': 'הקוד לא תואם. נותרו {left} ניסיונות.',
  'auth.err.expired': 'הקוד פג תוקף. בקשו קוד חדש.',
  'auth.err.locked': 'יותר מדי ניסיונות. נסו שוב בעוד {sec}.',
  'auth.devHint': 'מצב פיתוח: הקוד הוא {code}',

  'profile.title': 'כמה פרטים',
  'profile.displayName': 'השם שלכם',
  'profile.country': 'מדינה',
  'profile.phone': 'טלפון',
  'profile.email': 'אימייל',
  'profile.address': 'כתובת',
  'profile.address.street': 'רחוב',
  'profile.address.city': 'עיר',
  'profile.address.postal': 'מיקוד',
  'profile.kyc.disclosureTitle': 'מדוע נבקש זיהוי בהמשך',
  'profile.kyc.disclosure': 'נבקש זיהוי בהמשך, רק אם העברה תדרוש זאת. אפשר להתחיל עכשיו.',
  'profile.saving': 'שומר…',
  'profile.language': 'שפה',
  'profile.kycStatus': 'סטטוס אימות',
  'profile.kyc.NONE': 'לא נדרש עדיין',
  'profile.kyc.PENDING': 'בבדיקה',
  'profile.kyc.VERIFIED': 'מאומת',
  'profile.kyc.REJECTED': 'דורש טיפול',
  'profile.verifyNow': 'אימות עכשיו',

  'home.greeting': 'שלום{name}',
  'home.send': 'שליחת כסף',
  'home.sendAgain': 'שליחה חוזרת',
  'home.recentActivity': 'פעילות אחרונה',
  'home.noTransfers': 'אין העברות עדיין. שליחה לוקחת כדקה.',
  'home.noRecipients': 'הוסיפו נמען ראשון',
  'home.kycNudge': 'שלב אימות מתקרב. הקישו כדי להבין מדוע.',
  'home.activityFailed': 'לא ניתן לטעון פעילות.',

  'rcpt.title': 'נמענים',
  'rcpt.add': 'הוספת נמען',
  'rcpt.addFirst': 'הוסיפו נמען ראשון',
  'rcpt.empty': 'אין נמענים עדיין.',
  'rcpt.displayName': 'שם הנמען',
  'rcpt.relationship': 'קרבה (לא חובה)',
  'rcpt.payoutMethod': 'איך הם מקבלים',
  'rcpt.bank.account': 'מספר חשבון',
  'rcpt.bank.routing': 'מספר ניתוב',
  'rcpt.bank.type': 'סוג חשבון',
  'rcpt.bank.checking': 'עו״ש',
  'rcpt.bank.savings': 'חיסכון',
  'rcpt.trust':
    'פרטי הבנק מוצפנים ומאוסקנים — אנחנו לא שומרים את מספר החשבון המלא של הנמען.',
  'rcpt.submitting': 'מגדיר…',
  'rcpt.registering': 'מגדירים את {name} מול שותף התשלומים — בדרך כלל פחות מדקה. אפשר להמשיך.',
  'rcpt.ready': '{name} מוכן',
  'rcpt.failed': 'לא הצלחנו להגדיר את {name}.',
  'rcpt.duplicate': 'כבר יש לכם את {name} עם החשבון הזה.',
  'rcpt.editBankWarn': 'פעולה זו מאמתת מחדש את הנמען ומשהה העברות אליו עד שיהיה מוכן.',
  'rcpt.maskedTo': 'אל ••••{last4}',
  'rcpt.err.routing': 'הזינו מספר ניתוב תקין בן 9 ספרות.',
  'rcpt.err.account': 'הזינו את מספר החשבון.',
  'rcpt.err.name': 'הזינו את שם הנמען.',

  'payout.BANK_RTP': 'מיידי',
  'payout.BANK_FEDNOW': 'מיידי',
  'payout.BANK_ACH': 'רגיל',
  'payin.MESH': 'ארנק קריפטו / בורסה',
  'payin.ONRAMP': 'העברה בנקאית (שקלים)',
  'payin.IL_BANK': 'העברה מבנק ישראלי',

  'wiz.step': 'שלב {n} מתוך 5',
  'wiz.step.recipient': 'נמען',
  'wiz.step.amount': 'סכום',
  'wiz.step.payin': 'תשלום',
  'wiz.step.payout': 'מסירה',
  'wiz.step.review': 'סקירה',
  'wiz.recipient.pick': 'למי אתם שולחים?',
  'wiz.recipient.addNew': 'הוספת נמען חדש',
  'wiz.recipient.search': 'חיפוש נמענים',
  'wiz.recipient.settingUp': 'בהגדרה — אפשר להמשיך, נהיה מוכנים לפני שהכסף זז.',
  'wiz.recipient.fix': 'תיקון נמען',
  'wiz.amount.label': 'אתם שולחים',
  'wiz.amount.belowFloor': 'הסכום המינימלי לשליחה הוא בערך {amt} ($1.00 למסירה).',
  'wiz.amount.quoteErr': 'לא ניתן לקבל שער — נסו שוב',
  'wiz.payin.title': 'איך תשלמו?',
  'wiz.payout.title': 'איך הם יקבלו?',
  'wiz.payout.instant': 'מגיע תוך דקות.',
  'wiz.payout.standard': '1–3 ימי עסקים, עמלה נמוכה יותר.',
  'wiz.payout.recommended': 'מומלץ',
  'wiz.payout.achOnly': 'הבנק של הנמען תומך רק במסלול הרגיל.',
  'wiz.review.title': 'סקירה ושליחה',
  'wiz.review.confirm': 'אישור ושליחת {total}',
  'wiz.review.confirming': 'שולח…',
  'wiz.review.to': 'אל',
  'wiz.review.via': 'תשלום',
  'wiz.review.delivery': 'מסירה',
  'wiz.review.rateLocks': 'השער ננעל בסקירה',
  'wiz.review.expiresIn': 'השער נעול · {sec}',
  'wiz.review.expired': 'השער עודכן — בדקו את הסכום החדש.',
  'wiz.review.reaccept': 'שימוש בשער החדש',
  'wiz.review.recipientNotReady': 'נגדיר את {name} לפני שהכסף זז — להמשיך?',

  'rail.youSend': 'אתם שולחים',
  'rail.fee': 'עמלה',
  'rail.rate': 'שער',
  'rail.theyGet': 'הם מקבלים',
  'rail.arrives': 'מגיע',
  'rail.rateValue': '1 ₪ = {usd}',

  'fund.title': 'השלימו את התשלום',
  'fund.track': 'מעקב אחר ההעברה',
  'fund.mesh.title': 'חברו ארנק או בורסה',
  'fund.mesh.body': 'נמשיך מכאן ברגע שההעברה תאושר ברשת.',
  'fund.mesh.connect': 'חיבור',
  'fund.onramp.title': 'שלחו העברה בנקאית',
  'fund.onramp.next': 'מה קורה עכשיו',
  'fund.onramp.step1': 'העבירו את הסכום המדויק לחשבון שלהלן.',
  'fund.onramp.step2': 'כללו את האסמכתא כדי שנוכל להתאים.',
  'fund.onramp.step3': 'אין אישור ידני — אנחנו מגיבים להעברה אוטומטית.',
  'fund.onramp.bank': 'בנק',
  'fund.onramp.account': 'מספר חשבון',
  'fund.onramp.reference': 'אסמכתא',
  'fund.ilbank.title': 'שלחו העברה מבנק ישראלי',
  'fund.ilbank.beneficiary': 'מוטב',
  'fund.ilbank.iban': 'IBAN',
  'fund.ilbank.reference': 'אסמכתא',
  'fund.ilbank.window': 'נא לשלוח תוך 72 שעות.',

  'track.title': 'מעקב',
  'track.now': 'עכשיו: {stage}',
  'track.eta': 'מגיע עד {date}',
  'track.settlement': 'פרטי סליקה',
  'track.bridgeId': 'מזהה העברת Bridge',
  'track.rail': 'מסלול',
  'track.settledAt': 'נסלק ב',
  'track.saveReceipt': 'שמירת קבלה',
  'track.lastUpdate': 'עובדים על זה — עדכון אחרון {rel}',
  'track.recipientSetup': 'מגדירים את {name}',
  'track.delivered': 'נמסרו {amt} אל {name}',
  'track.sendAgain': 'שליחה חוזרת',
  'track.fail.preDispatch': 'ההעברה לא בוצעה. {total} לא חויבו.',
  'track.fail.bridge':
    'לא הצלחנו להעביר אל {name}. {total} יוחזרו עד {date}. אין צורך לעשות דבר.',
  'track.reversing': 'מחזירים את {total} — עד {date}. אין צורך לעשות דבר.',
  'track.refunded': '{total} הוחזרו לכם.',
  'track.ach': 'מגיע עד {date} (מסלול בנקאי איטי יותר).',

  'activity.title': 'פעילות',
  'activity.search': 'חיפוש לפי נמען',
  'activity.empty': 'אין העברות עדיין.',
  'activity.loadMore': 'טען עוד',
  'activity.row': '{send} אל {name}, {status}, {rel}',
  'activity.receipt': 'קבלה',
  'activity.timeline': 'ציר זמן',

  'conn.connecting': 'מתחבר…',
  'conn.live': 'חי',
  'conn.reconnecting': 'מתחבר מחדש…',
  'conn.closed': 'לא מקוון',
};

const CATALOG: Record<Lang, Record<MsgKey, string>> = { en, he };

export function dirFor(lang: Lang): Dir {
  return lang === 'he' ? 'rtl' : 'ltr';
}

export function localeFor(lang: Lang): string {
  return lang === 'he' ? 'he-IL' : 'en-US';
}

function interpolate(template: string, vars?: Vars): string {
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (_, k: string) =>
    k in vars ? String(vars[k]) : `{${k}}`,
  );
}

export function translate(lang: Lang, key: MsgKey, vars?: Vars): string {
  const table = CATALOG[lang] ?? CATALOG.en;
  return interpolate(table[key] ?? CATALOG.en[key] ?? key, vars);
}

// Unicode bidi isolation so LTR numerals/codes render correctly inside RTL.
const LRI = '⁦';
const PDI = '⁩';
export function ltrIsolate(s: string): string {
  return `${LRI}${s}${PDI}`;
}

function readInitialLang(): Lang {
  if (typeof window === 'undefined') return 'en';
  const stored = window.localStorage.getItem(STORAGE_KEY);
  return stored === 'he' ? 'he' : 'en';
}

interface I18nCtx {
  lang: Lang;
  dir: Dir;
  setLang: (l: Lang) => void;
  toggle: () => void;
  t: (key: MsgKey, vars?: Vars) => string;
}

const Ctx = createContext<I18nCtx | null>(null);

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(readInitialLang);

  useEffect(() => {
    const html = document.documentElement;
    html.lang = lang;
    html.dir = dirFor(lang);
    window.localStorage.setItem(STORAGE_KEY, lang);
  }, [lang]);

  const setLang = useCallback((l: Lang) => setLangState(l), []);
  const toggle = useCallback(
    () => setLangState((p) => (p === 'en' ? 'he' : 'en')),
    [],
  );
  const t = useCallback(
    (key: MsgKey, vars?: Vars) => translate(lang, key, vars),
    [lang],
  );

  const value = useMemo<I18nCtx>(
    () => ({ lang, dir: dirFor(lang), setLang, toggle, t }),
    [lang, setLang, toggle, t],
  );

  return createElement(Ctx.Provider, { value }, children);
}

export function useT(): I18nCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useT must be used within I18nProvider');
  return ctx;
}

// ---- money / date formatting (numerals stay LTR via bidi isolation) ----

export function moneyToNumber(m: Money): number {
  const minorPerUnit = m.currency === 'USD' ? 1_000_000 : 100; // USDC 6dp; ILS agorot
  return Number(BigInt(m.minor)) / minorPerUnit;
}

export function fmtMoney(m: Money, lang: Lang): string {
  const n = moneyToNumber(m);
  const s = new Intl.NumberFormat(localeFor(lang), {
    style: 'currency',
    currency: m.currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n);
  return ltrIsolate(s);
}

export function fmtRate(rate: string, lang: Lang): string {
  const n = Number(rate);
  const s = new Intl.NumberFormat(localeFor(lang), {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 4,
    maximumFractionDigits: 4,
  }).format(Number.isFinite(n) ? n : 0);
  return ltrIsolate(s);
}

export function fmtDate(iso: string, lang: Lang): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return ltrIsolate(iso);
  return ltrIsolate(
    d.toLocaleDateString(localeFor(lang), {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
    }),
  );
}

export function fmtDateTime(iso: string, lang: Lang): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return ltrIsolate(iso);
  return ltrIsolate(d.toLocaleString(localeFor(lang)));
}

export function fmtRelative(iso: string, lang: Lang): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return ltrIsolate(iso);
  const diffSec = Math.round((then - Date.now()) / 1000);
  const rtf = new Intl.RelativeTimeFormat(localeFor(lang), { numeric: 'auto' });
  const abs = Math.abs(diffSec);
  let out: string;
  if (abs < 60) out = rtf.format(Math.round(diffSec), 'second');
  else if (abs < 3600) out = rtf.format(Math.round(diffSec / 60), 'minute');
  else if (abs < 86400) out = rtf.format(Math.round(diffSec / 3600), 'hour');
  else out = rtf.format(Math.round(diffSec / 86400), 'day');
  return ltrIsolate(out);
}
