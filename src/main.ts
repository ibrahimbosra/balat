import './style.css'
import { initializeApp } from 'firebase/app'
import {
  browserLocalPersistence,
  createUserWithEmailAndPassword,
  getAuth,
  onAuthStateChanged,
  setPersistence,
  signInWithEmailAndPassword,
  signOut,
  type User,
} from 'firebase/auth'
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getFirestore,
  onSnapshot,
  query,
  runTransaction,
  setDoc,
  updateDoc,
  writeBatch,
  type DocumentReference,
} from 'firebase/firestore'
import {
  createBackupArchive,
  executeRestorePlan,
  prepareRestorePlan,
  readBackupArchive,
  type RestoreMode,
  type ValidatedBackup,
} from './user-backup'

const firebaseConfig = {
  apiKey: 'AIzaSyAnaTxPXhxMI3A-U4IucbEDfQ8hOTbix_w',
  authDomain: 'msalma-1d983.firebaseapp.com',
  projectId: 'msalma-1d983',
  storageBucket: 'msalma-1d983.firebasestorage.app',
  messagingSenderId: '1029462661783',
  appId: '1:1029462661783:web:61a7c2fd8336326fab27d2',
}

initializeApp(firebaseConfig)
const auth = getAuth()
const db = getFirestore()
const appRoot = document.querySelector<HTMLDivElement>('#app')!

type ServiceUnit = 'SQM' | 'LM' | 'CBM' | 'PCS' | 'LOT' | 'PROJECT' | 'GROUP'

type AppSettings = {
  syriaEnabled: boolean
  exchangeRate: number
  darkMode: boolean
  localCurrencyCode: string
  localCurrencyName: string
}

type WorkService = {
  id: string
  name: string
  price: number
  currencyCode: string
  unit: ServiceUnit
  description: string
  createdAt: string
  updatedAt: string
}

type Customer = {
  id: string
  name: string
  phone: string
  address: string
  notes: string
  createdAt: string
  updatedAt: string
}

type InvoicePayment = {
  amount: number
  date: string
  note: string
  createdAt: string
}

type StoredInvoiceItem = {
  name: string
  notes: string
  quantity: number
  unit: string
  unitPrice: number
  total: number
  cancelled?: boolean
}

type InvoiceUnitTotal = {
  unit: string
  quantity: number
  amount: number | null
}

type InvoiceExportFormat = 'image' | 'image-high' | 'excel'

type StoredInvoiceDiscount = {
  mode: 'percentage' | 'amount'
  value: number
  amount: number
} | null

type StoredInvoiceEditableItem = {
  custom: boolean
  name: string
  notes: string
  quantity: string
  price: string
  unit: string
  unitCode: ServiceUnit | null
  currencyCode: string
  cancelled?: boolean
}

type InvoiceRecord = {
  id: string
  invoiceNumber: string
  rootId: string
  rootInvoiceNumber: string
  parentId: string | null
  version: number
  rows: StoredInvoiceItem[]
  unitTotals: InvoiceUnitTotal[]
  items: StoredInvoiceEditableItem[]
  total: number
  discount: StoredInvoiceDiscount
  exportFormat: InvoiceExportFormat
  exportDate: string
  customerId: string | null
  customerName: string
  customerPhone: string
  customerAddress: string
  responsibleTeacherName: string
  payments: InvoicePayment[]
  savedAt: string
  createdAt: string
  updatedAt: string
}

type MainSection = 'services' | 'customers' | 'invoices'

const defaultSettings: AppSettings = {
  syriaEnabled: false,
  exchangeRate: 0,
  darkMode: true,
  localCurrencyCode: 'ليرة',
  localCurrencyName: 'ليرة',
}

let currentUser: User | null = null
let dataUserId = ''
let authSessionId = 0
let settings: AppSettings = defaultSettings
let activeMainSection: MainSection = 'services'
let workServices: WorkService[] = []
let customers: Customer[] = []
let invoiceRecords: InvoiceRecord[] = []
let unsubscribeServices: () => void = () => undefined
let unsubscribeCustomers: () => void = () => undefined
let unsubscribeInvoices: () => void = () => undefined

const settingsKey = (ownerId: string) => `asaar-settings-${ownerId}`

const icon = (name: 'plus' | 'settings' | 'search' | 'download' | 'invoice' | 'close' | 'eye' | 'eye-off' | 'users' | 'history' | 'edit' | 'trash') => ({
  plus: '<path d="M12 5v14M5 12h14"/>',
  settings: '<path d="M12 3.5a2 2 0 0 1 2 2v.2a6.8 6.8 0 0 1 1.8 1l.2-.1a2 2 0 1 1 2 3.5l-.2.1a6.8 6.8 0 0 1 0 2.1l.2.1a2 2 0 1 1-2 3.5l-.2-.1a6.8 6.8 0 0 1-1.8 1v.2a2 2 0 1 1-4 0v-.2a6.8 6.8 0 0 1-1.8-1l-.2.1a2 2 0 1 1-2-3.5l.2-.1a6.8 6.8 0 0 1 0-2.1l-.2-.1a2 2 0 1 1 2-3.5l.2.1a6.8 6.8 0 0 1 1.8-1v-.2a2 2 0 0 1 2-2Z"/><circle cx="12" cy="12" r="2.5"/>',
  search: '<circle cx="10.8" cy="10.8" r="6.8"/><path d="m16 16 4 4"/>',
  download: '<path d="M12 4v11m0 0 4-4m-4 4-4-4M5 20h14"/>',
  invoice: '<path d="M6 3.5h8l4 4V20a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V3.5Z"/><path d="M14 3.5V8h4M9 12h6M9 15h6M9 18h3"/>',
  close: '<path d="m6 6 12 12M18 6 6 18"/>',
  eye: '<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>',
  'eye-off': '<path d="m3 3 18 18"/><path d="M10.6 10.6a2 2 0 0 0 2.8 2.8"/><path d="M9.9 5.2A10.7 10.7 0 0 1 12 5c6.4 0 10 7 10 7a15.6 15.6 0 0 1-3.2 4.1"/><path d="M6.6 6.6C3.6 8.2 2 12 2 12s3.6 7 10 7a10.7 10.7 0 0 0 4.1-.8"/>',
  users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
  history: '<path d="M3 12a9 9 0 1 0 3-6.7"/><path d="M3 4v4h4"/><path d="M12 7v5l3 2"/>',
  edit: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/>',
  trash: '<path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/>',
}[name])

const svg = (name: 'plus' | 'settings' | 'search' | 'download' | 'invoice' | 'close' | 'eye' | 'eye-off' | 'users' | 'history' | 'edit' | 'trash') =>
  `<svg viewBox="0 0 24 24" aria-hidden="true">${icon(name)}</svg>`

const money = (value: number) =>
  Number.isFinite(value)
    ? new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(value)
    : '—'
const invoiceQuantity = (value: number) =>
  Number.isFinite(value)
    ? new Intl.NumberFormat('en-US', { maximumFractionDigits: 6 }).format(value)
    : '—'

function escapeHtml(value: string) {
  return value.replace(/[&<>'"]/g, (character) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[character] || character))
}

function applyTheme(value: boolean) {
  document.body.classList.toggle('dark-mode', value)
}

function safeSettings(value: unknown): AppSettings {
  const data = typeof value === 'object' && value !== null ? value as Partial<AppSettings> : {}
  return {
    syriaEnabled: data.syriaEnabled === true,
    exchangeRate: typeof data.exchangeRate === 'number' && Number.isFinite(data.exchangeRate) && data.exchangeRate > 0
      ? data.exchangeRate
      : 0,
    darkMode: typeof data.darkMode === 'boolean' ? data.darkMode : true,
    localCurrencyCode: 'ليرة',
    localCurrencyName: 'ليرة',
  }
}

function loadCachedSettings(ownerId: string): AppSettings {
  try {
    return safeSettings(JSON.parse(localStorage.getItem(settingsKey(ownerId)) || 'null'))
  } catch {
    return defaultSettings
  }
}

function saveCachedSettings(ownerId: string, value: AppSettings) {
  localStorage.setItem(settingsKey(ownerId), JSON.stringify(value))
}

function resolveDataUserId(user: User): string {
  const shared = new Set(['mothanamsa@gmail.com', 'msalma@gmail.com'])
  return shared.has(user.email?.trim().toLowerCase() || '') ? '8zgVSfgflNStj4rlBblTUKE7zi42' : user.uid
}

function parseWorkService(id: string, data: Record<string, unknown>): WorkService | null {
  const name = typeof data.name === 'string' ? data.name.trim() : ''
  const price = typeof data.price === 'number' && Number.isFinite(data.price) && data.price >= 0 ? data.price : NaN
  const unit = data.unit === 'CBM'
    ? 'CBM'
    : data.unit === 'PCS'
      ? 'PCS'
      : data.unit === 'LOT'
        ? 'LOT'
        : data.unit === 'PROJECT'
          ? 'PROJECT'
          : data.unit === 'GROUP'
            ? 'GROUP'
            : data.unit === 'LM'
              ? 'LM'
              : data.unit === 'SQM'
                ? 'SQM'
                : null
  if (!name || !unit || !Number.isFinite(price)) return null
  return {
    id,
    name,
    price,
    currencyCode: typeof data.currencyCode === 'string' && data.currencyCode.trim()
      ? (data.currencyCode.trim().toUpperCase() === 'USD' ? 'USD' : 'ليرة')
      : 'USD',
    unit,
    description: typeof data.description === 'string' ? data.description.trim() : '',
    createdAt: typeof data.createdAt === 'string' ? data.createdAt : '',
    updatedAt: typeof data.updatedAt === 'string' ? data.updatedAt : '',
  }
}

function parseCustomer(id: string, data: Record<string, unknown>): Customer | null {
  const name = typeof data.name === 'string' ? data.name.trim() : ''
  if (!name) return null
  return {
    id,
    name,
    phone: typeof data.phone === 'string' ? data.phone.trim() : '',
    address: typeof data.address === 'string' ? data.address.trim() : '',
    notes: typeof data.notes === 'string' ? data.notes.trim() : '',
    createdAt: typeof data.createdAt === 'string' ? data.createdAt : '',
    updatedAt: typeof data.updatedAt === 'string' ? data.updatedAt : '',
  }
}

type CustomerIdentityMatch =
  | { kind: 'exact'; customer: Customer }
  | { kind: 'phone-conflict'; customer: Customer }
  | { kind: 'address-needed'; customer: Customer }
  | { kind: 'multiple-matches' }

class CustomerIdentityError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'CustomerIdentityError'
  }
}

function normalizeCustomerText(value: string) {
  return value
    .normalize('NFKC')
    .replace(/[\u064B-\u065F\u0670\u0640]/g, '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLocaleLowerCase('ar')
}

function normalizeCustomerPhone(value: string) {
  return value
    .replace(/[٠-٩]/g, (digit) => String(digit.charCodeAt(0) - 0x660))
    .replace(/[۰-۹]/g, (digit) => String(digit.charCodeAt(0) - 0x6f0))
    .replace(/\D/g, '')
}

function findCustomerIdentityMatch(
  name: string,
  phone: string,
  address: string,
  excludeCustomerId?: string,
): CustomerIdentityMatch | null {
  const nameKey = normalizeCustomerText(name)
  const phoneKey = normalizeCustomerPhone(phone)
  const addressKey = normalizeCustomerText(address)
  const candidates = customers.filter((customer) => customer.id !== excludeCustomerId)

  if (phoneKey) {
    const phoneMatches = candidates.filter((customer) => normalizeCustomerPhone(customer.phone) === phoneKey)
    if (phoneMatches.length) {
      const exactMatch = phoneMatches.find((customer) =>
        !nameKey || normalizeCustomerText(customer.name) === nameKey)
      return exactMatch
        ? { kind: 'exact', customer: exactMatch }
        : { kind: 'phone-conflict', customer: phoneMatches[0] }
    }
    return null
  }

  if (!nameKey) return null
  const sameName = candidates.filter((customer) => normalizeCustomerText(customer.name) === nameKey)
  if (addressKey) {
    const exactMatches = sameName.filter((customer) => normalizeCustomerText(customer.address) === addressKey)
    if (exactMatches.length === 1) return { kind: 'exact', customer: exactMatches[0] }
    if (exactMatches.length > 1) return { kind: 'multiple-matches' }
    return null
  }
  if (sameName.length === 1) return { kind: 'address-needed', customer: sameName[0] }
  if (sameName.length > 1) return { kind: 'multiple-matches' }
  return null
}

function customerIdentityMessage(match: CustomerIdentityMatch, context: 'invoice' | 'customer') {
  if (match.kind === 'exact') {
    return context === 'invoice'
      ? 'الزبون مسجل بالفعل، وسيتم ربط الفاتورة باسمه.'
      : 'هذا الزبون مسجل بالفعل ولا يمكن إضافته مرة أخرى.'
  }
  if (match.kind === 'phone-conflict') {
    return `رقم الهاتف مرتبط بزبون اسمه ${match.customer.name}. اختره من القائمة أو تحقق من صحة البيانات.`
  }
  if (match.kind === 'address-needed') {
    return `يوجد زبون مسجل باسم ${match.customer.name}. أدخل العنوان لتمييزه أو اختره من القائمة.`
  }
  return 'توجد عدة سجلات محتملة لهذا الاسم. اختر الزبون من القائمة أو أضف رقم الهاتف لتحديده.'
}

function parseInvoiceRecord(id: string, data: Record<string, unknown>): InvoiceRecord | null {
  const invoiceNumber = typeof data.invoiceNumber === 'string' ? data.invoiceNumber.trim() : ''
  if (!invoiceNumber) return null
  const rootId = typeof data.rootId === 'string' && data.rootId.trim() ? data.rootId.trim() : id
  const rootInvoiceNumber = typeof data.rootInvoiceNumber === 'string' && data.rootInvoiceNumber.trim()
    ? data.rootInvoiceNumber.trim()
    : invoiceNumber
  const rows = Array.isArray(data.rows) ? data.rows.map((row) => {
    const item = row && typeof row === 'object' ? row as Record<string, unknown> : {}
    const quantity = typeof item.quantity === 'number' && Number.isFinite(item.quantity) ? item.quantity : 0
    const unitPrice = typeof item.unitPrice === 'number' && Number.isFinite(item.unitPrice) ? item.unitPrice : 0
    const total = typeof item.total === 'number' && Number.isFinite(item.total) ? item.total : quantity * unitPrice
    return {
      name: typeof item.name === 'string' ? item.name : '',
      notes: typeof item.notes === 'string' ? item.notes : '',
      quantity,
      unit: typeof item.unit === 'string' ? item.unit : '',
      unitPrice,
      total,
      cancelled: item.cancelled === true,
    }
  }) : []
  const unitTotals = Array.isArray(data.unitTotals) ? data.unitTotals.map((entry) => {
    const item = entry && typeof entry === 'object' ? entry as Record<string, unknown> : {}
    return {
      unit: typeof item.unit === 'string' ? item.unit : '',
      quantity: typeof item.quantity === 'number' && Number.isFinite(item.quantity) ? item.quantity : 0,
      amount: typeof item.amount === 'number' && Number.isFinite(item.amount) ? item.amount : null,
    }
  }) : []
  const items: StoredInvoiceEditableItem[] = Array.isArray(data.items) ? data.items.map((entry) => {
    const item = entry && typeof entry === 'object' ? entry as Record<string, unknown> : {}
    const unitCode: ServiceUnit | null = item.unitCode === 'CBM' || item.unitCode === 'PCS' || item.unitCode === 'LOT' || item.unitCode === 'PROJECT' || item.unitCode === 'GROUP' || item.unitCode === 'LM' || item.unitCode === 'SQM'
      ? item.unitCode
      : null
    return {
      custom: item.custom === true,
      name: typeof item.name === 'string' ? item.name : '',
      notes: typeof item.notes === 'string' ? item.notes : '',
      quantity: typeof item.quantity === 'string' ? item.quantity : (typeof item.quantity === 'number' ? String(item.quantity) : ''),
      price: typeof item.price === 'string' ? item.price : (typeof item.price === 'number' ? String(item.price) : ''),
      unit: typeof item.unit === 'string' ? item.unit : '',
      unitCode,
      currencyCode: typeof item.currencyCode === 'string' && item.currencyCode.trim() ? item.currencyCode.trim() : 'USD',
      cancelled: item.cancelled === true,
    }
  }) : []
  const discount: StoredInvoiceDiscount = data.discount && typeof data.discount === 'object'
    ? (() => {
      const d = data.discount as Record<string, unknown>
      const mode = d.mode === 'percentage' ? 'percentage' : d.mode === 'amount' ? 'amount' : null
      const value = typeof d.value === 'number' && Number.isFinite(d.value) ? d.value : NaN
      const amount = typeof d.amount === 'number' && Number.isFinite(d.amount) ? d.amount : NaN
      return mode && Number.isFinite(value) && Number.isFinite(amount) ? { mode, value, amount } : null
    })()
    : null
  let payments = Array.isArray(data.payments) ? data.payments.map((entry) => {
    const item = entry && typeof entry === 'object' ? entry as Record<string, unknown> : {}
    return {
      amount: typeof item.amount === 'number' && Number.isFinite(item.amount) ? item.amount : 0,
      date: typeof item.date === 'string' ? item.date : '',
      note: typeof item.note === 'string' ? item.note : '',
      createdAt: typeof item.createdAt === 'string' ? item.createdAt : '',
    }
  }).filter((payment) => payment.amount > 0) : []
  if (!payments.length) {
    const upfrontAmount = typeof data.upfrontPayment === 'number' && Number.isFinite(data.upfrontPayment) ? data.upfrontPayment : 0
    const upfrontDate = typeof data.upfrontPaymentDate === 'string' ? data.upfrontPaymentDate : ''
    if (upfrontAmount > 0) payments = [{ amount: upfrontAmount, date: upfrontDate, note: '', createdAt: '' }]
  }
  return {
    id,
    invoiceNumber,
    rootId,
    rootInvoiceNumber,
    parentId: typeof data.parentId === 'string' && data.parentId.trim() ? data.parentId.trim() : null,
    version: typeof data.version === 'number' && Number.isFinite(data.version) ? data.version : 1,
    rows,
    unitTotals,
    items,
    total: typeof data.total === 'number' && Number.isFinite(data.total) ? data.total : 0,
    discount,
    exportFormat: data.exportFormat === 'excel' || data.exportFormat === 'image' ? data.exportFormat : 'image-high',
    exportDate: typeof data.exportDate === 'string' ? data.exportDate : '',
    customerId: typeof data.customerId === 'string' && data.customerId.trim() ? data.customerId.trim() : null,
    customerName: typeof data.customerName === 'string' ? data.customerName : '',
    customerPhone: typeof data.customerPhone === 'string' ? data.customerPhone : '',
    customerAddress: typeof data.customerAddress === 'string' ? data.customerAddress : '',
    responsibleTeacherName: typeof data.responsibleTeacherName === 'string' ? data.responsibleTeacherName : '',
    payments,
    savedAt: typeof data.savedAt === 'string' ? data.savedAt : '',
    createdAt: typeof data.createdAt === 'string' ? data.createdAt : '',
    updatedAt: typeof data.updatedAt === 'string' ? data.updatedAt : '',
  }
}

function serviceUnitLabel(unit: ServiceUnit): string {
  if (unit === 'SQM') return 'متر مربع'
  if (unit === 'LM') return 'متر جر'
  if (unit === 'CBM') return 'متر مكعب'
  if (unit === 'PCS') return 'قطعة / عدد'
  if (unit === 'LOT') return 'مقطوعية'
  if (unit === 'PROJECT') return 'مشروع'
  return 'مجموعة'
}

function modal(content: string) {
  document.querySelectorAll<HTMLDivElement>('.modal-backdrop').forEach((element) => element.remove())
  const backdrop = document.createElement('div')
  backdrop.className = 'modal-backdrop'
  backdrop.innerHTML = `<section class="modal">${content}</section>`
  backdrop.addEventListener('click', (event) => {
    if (event.target === backdrop) backdrop.remove()
  })
  document.body.append(backdrop)
  return backdrop
}

function showToast(message: string) {
  let toast = document.querySelector<HTMLElement>('#app-toast')
  if (!toast) {
    toast = document.createElement('div')
    toast.id = 'app-toast'
    toast.className = 'app-toast'
    toast.setAttribute('role', 'alert')
    document.body.append(toast)
  }
  toast.textContent = message
  toast.classList.add('is-visible')
  window.setTimeout(() => toast?.classList.remove('is-visible'), 3000)
}

function friendlyError(error: unknown) {
  if (error instanceof CustomerIdentityError) return error.message
  const code = typeof error === 'object' && error && 'code' in error ? String((error as { code: string }).code) : ''
  if (code.includes('permission-denied')) return 'ليس لديك صلاحية تنفيذ هذا الإجراء.'
  if (code.includes('network') || code.includes('unavailable')) return 'تعذر الاتصال. تحقق من الإنترنت وحاول مجددًا.'
  return 'تعذر حفظ التغيير. حاول مجددًا.'
}

function renderBootstrap(message = 'جارٍ استعادة جلستك...') {
  appRoot.innerHTML = `<main class="bootstrap"><div class="brand-mark">أسطح</div><p>${message}</p></main>`
}

function renderAuth(error = '', signUp = false) {
  appRoot.innerHTML = `
    <main class="auth-page">
      <div class="brand-header">
        <div class="brand-mark">أسطح</div>
        <div class="brand-copy">
          <p class="eyebrow">إدارة أجور أعمال الأسطح والتشطيبات</p>
          <p class="auth-copy">خدمات البلاط والسيراميك والرخام في مكان واحد.</p>
        </div>
      </div>
      <div class="auth-header"><h2>${signUp ? 'إنشاء حساب جديد' : 'تسجيل الدخول إلى حسابك'}</h2></div>
      <form id="auth-form" class="auth-form">
        <label>البريد الإلكتروني<input name="email" type="email" autocomplete="email" placeholder="name@example.com" required></label>
        <label>كلمة المرور<input name="password" type="password" autocomplete="${signUp ? 'new-password' : 'current-password'}" minlength="6" required></label>
        ${signUp ? '<label>تأكيد كلمة المرور<input name="confirmPassword" type="password" autocomplete="new-password" minlength="6" required></label>' : ''}
        <p class="form-error">${escapeHtml(error)}</p>
        <button class="primary-button" type="submit">${signUp ? 'إنشاء الحساب' : 'تسجيل الدخول'}</button>
        <button class="text-button" type="button" id="toggle-auth">${signUp ? 'لديك حساب؟ تسجيل الدخول' : 'إنشاء حساب جديد'}</button>
      </form>
    </main>`
  document.querySelector('#toggle-auth')!.addEventListener('click', () => renderAuth('', !signUp))
  document.querySelector<HTMLFormElement>('#auth-form')!.addEventListener('submit', async (event) => {
    event.preventDefault()
    const form = new FormData(event.currentTarget as HTMLFormElement)
    const email = String(form.get('email')).trim()
    const password = String(form.get('password'))
    const submit = document.querySelector<HTMLButtonElement>('#auth-form button[type="submit"]')!
    submit.disabled = true
    try {
      if (signUp) {
        if (password !== String(form.get('confirmPassword'))) {
          renderAuth('كلمتا المرور غير متطابقتين', true)
          return
        }
        await createUserWithEmailAndPassword(auth, email, password)
      } else {
        await signInWithEmailAndPassword(auth, email, password)
      }
    } catch (authError) {
      const code = typeof authError === 'object' && authError && 'code' in authError
        ? String((authError as { code: string }).code)
        : ''
      renderAuth(code === 'auth/email-already-in-use'
        ? 'هذا البريد مستخدم من قبل.'
        : code === 'auth/network-request-failed'
          ? 'تعذر الاتصال بـ Firebase.'
          : 'تعذر تسجيل الدخول أو إنشاء الحساب.', signUp)
    }
  })
}

function getMainSearchQuery() {
  return document.querySelector<HTMLInputElement>('#main-search')?.value.trim().toLocaleLowerCase('ar') || ''
}

function updateServicesShell() {
  if (activeMainSection !== 'services') return
  const list = document.querySelector<HTMLElement>('#services-shell-list')
  const count = document.querySelector<HTMLElement>('#service-count')
  if (!list) return
  const search = getMainSearchQuery()
  const visible = workServices
    .filter((service) => service.name.toLocaleLowerCase('ar').includes(search))
    .sort((a, b) => a.name.localeCompare(b.name, 'ar'))
  if (count) count.textContent = String(visible.length)
  list.innerHTML = visible.length ? visible.map((service, index) => {
    const dollarPrice = service.currencyCode === 'USD'
      ? service.price
      : settings.syriaEnabled && settings.exchangeRate > 0
        ? service.price / settings.exchangeRate
        : Number.NaN
    const liraPrice = !settings.syriaEnabled || settings.exchangeRate <= 0
      ? null
      : service.currencyCode === 'USD'
        ? service.price * settings.exchangeRate
        : service.price
    return `
      <article class="service-row">
        <span class="service-order" aria-label="رقم الخدمة ${index + 1}">${index + 1}</span>
        <button class="service-main" type="button" data-edit-service="${service.id}">
          <span class="service-name">${escapeHtml(service.name)}</span>
          ${service.description ? `<span class="service-description">${escapeHtml(service.description)}</span>` : ''}
          <span class="service-unit">${escapeHtml(serviceUnitLabel(service.unit))}</span>
          <span class="service-details">
            <span class="service-price-cell">
              <span class="service-price-label">السعر بالدولار</span>
              <strong class="service-price">${Number.isFinite(dollarPrice) ? `${money(dollarPrice)} دولار` : 'غير متاح'}</strong>
            </span>
            <span class="service-price-cell service-lira-cell">
              <span class="service-price-label">السعر بالليرة السورية</span>
              <strong class="service-price">${liraPrice === null ? 'الليرة غير مفعلة' : `${money(liraPrice)} ليرة`}</strong>
            </span>
          </span>
        </button>
      </article>
    `
  }).join('') : `<div class="empty-state"><div class="empty-icon">⌕</div><h2>${workServices.length ? 'لا توجد نتائج' : 'ابدأ بإضافة أول خدمة'}</h2><p>${workServices.length ? 'جرّب كلمة بحث مختلفة.' : 'حدد اسم الخدمة والسعر ووحدة القياس.'}</p></div>`
  list.querySelectorAll<HTMLButtonElement>('[data-edit-service]').forEach((button) => {
    button.addEventListener('click', () => {
      const service = workServices.find((item) => item.id === button.dataset.editService)
      if (service) renderServiceEditor(service)
    })
  })
}

function renderCustomersSection() {
  const content = document.querySelector<HTMLElement>('#main-section-content')
  const count = document.querySelector<HTMLElement>('#service-count')
  if (!content) return
  const search = getMainSearchQuery()
  const visible = customers
    .filter((customer) => [customer.name, customer.phone, customer.address, customer.notes].join(' ').toLocaleLowerCase('ar').includes(search))
    .sort((a, b) => a.name.localeCompare(b.name, 'ar'))
  if (count) count.textContent = String(visible.length)
  content.innerHTML = visible.length ? `
    <section class="service-list customers-list">
      ${visible.map((customer, index) => `
        <article class="service-row customer-row">
          <span class="service-order" aria-label="رقم الزبون ${index + 1}">${index + 1}</span>
          <button class="service-main" type="button" data-edit-customer="${customer.id}">
            <span class="service-name">${escapeHtml(customer.name)}</span>
            ${customer.phone ? `<span class="service-description">${escapeHtml(customer.phone)}</span>` : ''}
            ${customer.address ? `<span class="service-unit">${escapeHtml(customer.address)}</span>` : '<span class="service-unit">بدون عنوان</span>'}
            ${customer.notes ? `<span class="service-description">${escapeHtml(customer.notes)}</span>` : ''}
          </button>
        </article>
      `).join('')}
    </section>
  ` : `<div class="empty-state"><div class="empty-icon">⌕</div><h2>${customers.length ? 'لا توجد نتائج' : 'ابدأ بإضافة أول زبون'}</h2><p>${customers.length ? 'جرّب كلمة بحث مختلفة.' : 'أضف اسم الزبون ورقم الهاتف والعنوان والملاحظات.'}</p></div>`
  content.querySelectorAll<HTMLButtonElement>('[data-edit-customer]').forEach((button) => {
    button.addEventListener('click', () => {
      const customer = customers.find((item) => item.id === button.dataset.editCustomer)
      if (customer) renderCustomerEditor(customer)
    })
  })
}

function renderInvoicesSection() {
  const content = document.querySelector<HTMLElement>('#main-section-content')
  const count = document.querySelector<HTMLElement>('#service-count')
  if (!content) return
  const search = getMainSearchQuery()
  const roots = [...invoiceRecords]
    .filter((record) => record.rootId === record.id)
    .sort((a, b) => Number(b.rootInvoiceNumber || b.invoiceNumber) - Number(a.rootInvoiceNumber || a.invoiceNumber))
    .filter((record) => [record.invoiceNumber, record.rootInvoiceNumber, record.customerName, record.customerPhone].join(' ').toLocaleLowerCase('ar').includes(search))
  if (count) count.textContent = String(roots.length)
  const formatDisplayDateTime = (value: string) => {
    const trimmed = value.trim()
    if (!trimmed) return '—'
    const isoLike = trimmed.includes('T') ? trimmed.replace('T', ' ').slice(0, 16) : trimmed
    const date = new Date(trimmed)
    return Number.isNaN(date.getTime()) ? (isoLike || '—') : formatInvoiceDateTime(date)
  }

  content.innerHTML = roots.length ? `
    <section class="service-list invoices-list invoice-summary-list">
      ${roots.map((record, index) => {
        const versions = getInvoiceRootVersions(record.rootId)
        const latest = versions[versions.length - 1] || record
        const status = getInvoicePaymentStatus(latest)
        const paymentsCount = latest.payments.length
        const paid = getInvoicePaidTotal(latest)
        const remaining = getInvoiceRemainingTotal(latest)
        const net = getInvoiceNetTotal(latest)
        const hasDiscount = Boolean(latest.discount && latest.discount.amount > 0.00001)
        const customerName = latest.customerName?.trim() || 'بدون اسم زبون'
        const customerPhone = latest.customerPhone?.trim() || ''
        const customerAddress = latest.customerAddress?.trim() || ''
        const matchedCustomer = customers.find((customer) => customer.id === latest.customerId)
          || customers.find((customer) =>
          customer.name.trim() === customerName
          && (!customerPhone || customer.phone.trim() === customerPhone))
          || customers.find((customer) => customer.name.trim() === customerName)
        const customerNotes = matchedCustomer?.notes?.trim() || ''
        const startDateSource = record.createdAt || record.savedAt || record.exportDate || latest.createdAt || latest.savedAt || latest.exportDate || ''
        const startDate = formatDisplayDateTime(startDateSource)
        const lastUpdate = formatDisplayDateTime(latest.exportDate || latest.savedAt || latest.createdAt || '')

        return `
          <article class="service-row invoice-row invoice-summary-card">
            <button class="invoice-summary-main" type="button" data-open-invoice-root="${record.rootId}" aria-label="فتح الفاتورة رقم ${escapeHtml(record.rootInvoiceNumber || record.invoiceNumber)}">
              <header class="invoice-summary-head">
                <div class="invoice-summary-identity">
                  <span class="service-order" aria-label="فاتورة ${index + 1}">${index + 1}</span>
                  <div class="invoice-summary-titles">
                    <span class="invoice-summary-kicker">ملخص الفاتورة</span>
                    <span class="service-name">فاتورة رقم ${escapeHtml(record.rootInvoiceNumber || record.invoiceNumber)}</span>
                  </div>
                </div>
                <span class="invoice-status-badge is-${status.key}" aria-label="حالة الفاتورة: ${escapeHtml(status.label)}">${escapeHtml(status.label)}</span>
              </header>

              <section class="invoice-summary-customer" aria-label="بيانات الزبون">
                <div class="invoice-summary-customer-grid">
                  <div class="invoice-customer-field">
                    <span class="invoice-customer-label">اسم الزبون</span>
                    <strong class="invoice-customer-value">${escapeHtml(customerName)}</strong>
                  </div>
                  <div class="invoice-customer-field">
                    <span class="invoice-customer-label">رقم الهاتف</span>
                    <strong class="invoice-customer-value">${customerPhone ? escapeHtml(customerPhone) : '—'}</strong>
                  </div>
                  <div class="invoice-customer-field">
                    <span class="invoice-customer-label">العنوان</span>
                    <strong class="invoice-customer-value">${customerAddress ? escapeHtml(customerAddress) : '—'}</strong>
                  </div>
                  <div class="invoice-customer-field invoice-customer-field--wide">
                    <span class="invoice-customer-label">ملاحظات الزبون</span>
                    <strong class="invoice-customer-value">${customerNotes ? escapeHtml(customerNotes) : '—'}</strong>
                  </div>
                </div>
              </section>

              <section class="invoice-summary-financials" aria-label="الملخص المالي">
                <div class="invoice-metric">
                  <span class="invoice-metric-label">الإجمالي</span>
                  <strong class="invoice-metric-value">${money(net)} <small>دولار</small></strong>
                </div>
                <div class="invoice-metric is-paid">
                  <span class="invoice-metric-label">المسدد</span>
                  <strong class="invoice-metric-value">${money(paid)} <small>دولار</small></strong>
                </div>
                <div class="invoice-metric is-remaining ${remaining <= 0.00001 ? 'is-clear' : 'is-due'}">
                  <span class="invoice-metric-label">الباقي</span>
                  <strong class="invoice-metric-value">${money(remaining)} <small>دولار</small></strong>
                </div>
              </section>
            </button>
            <div class="invoice-summary-extra" hidden>
              <footer class="invoice-summary-meta">
                <span class="invoice-meta-chip"><span>تاريخ البدء</span><strong>${escapeHtml(startDate)}</strong></span>
                <span class="invoice-meta-chip"><span>آخر تحديث</span><strong>${escapeHtml(lastUpdate)}</strong></span>
                ${hasDiscount ? `<span class="invoice-meta-chip"><span>قبل الخصم</span><strong>${money(latest.total)} دولار</strong></span><span class="invoice-meta-chip"><span>الخصم</span><strong>${money(latest.discount!.amount)} دولار</strong></span>` : ''}
                <span class="invoice-meta-chip"><span>بعد الخصم</span><strong>${money(net)} دولار</strong></span>
                <span class="invoice-meta-chip"><span>عدد الدفعات</span><strong>${paymentsCount}</strong></span>
              </footer>
            </div>
            <button class="invoice-summary-toggle" type="button" aria-expanded="false" aria-label="عرض تفاصيل إضافية للفاتورة">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 9l6 6 6-6"></path></svg>
            </button>
          </article>
        `
      }).join('')}
    </section>
  ` : `<div class="empty-state"><div class="empty-icon">⌕</div><h2>${invoiceRecords.length ? 'لا توجد نتائج' : 'لا توجد فواتير محفوظة'}</h2><p>${invoiceRecords.length ? 'جرّب كلمة بحث مختلفة.' : 'سيتم حفظ كل فاتورة يتم تصديرها هنا تلقائيًا.'}</p></div>`
  content.querySelectorAll<HTMLButtonElement>('[data-open-invoice-root]').forEach((button) => {
    button.addEventListener('click', () => {
      const rootId = button.dataset.openInvoiceRoot
      if (rootId) renderInvoiceVersionsDialog(rootId)
    })
  })
  content.querySelectorAll<HTMLButtonElement>('.invoice-summary-toggle').forEach((button) => {
    button.addEventListener('click', (event) => {
      event.preventDefault()
      event.stopPropagation()
      const card = button.closest<HTMLElement>('.invoice-summary-card')
      const extra = card?.querySelector<HTMLElement>('.invoice-summary-extra')
      if (!card || !extra) return
      const open = Boolean(extra.hidden)
      extra.hidden = !open
      card.classList.toggle('is-meta-open', open)
      button.setAttribute('aria-expanded', open ? 'true' : 'false')
      button.setAttribute('aria-label', open ? 'إخفاء التفاصيل الإضافية للفاتورة' : 'عرض تفاصيل إضافية للفاتورة')
    })
  })
}

function renderActiveSection() {
  const head = document.querySelector<HTMLElement>('#main-section-head h1')
  const content = document.querySelector<HTMLElement>('#main-section-content')
  const search = document.querySelector<HTMLInputElement>('#main-search')
  const addButton = document.querySelector<HTMLButtonElement>('#main-add')
  const exportButton = document.querySelector<HTMLButtonElement>('#open-export')
  if (!head || !content) return
  if (search) {
    search.placeholder = activeMainSection === 'services'
      ? 'ابحث عن خدمة...'
      : activeMainSection === 'customers'
        ? 'ابحث عن زبون...'
        : 'ابحث برقم الفاتورة أو اسم الزبون...'
    search.value = ''
  }
  if (addButton) {
    addButton.hidden = activeMainSection === 'invoices'
    addButton.setAttribute('aria-label', activeMainSection === 'customers' ? 'إضافة زبون' : 'إضافة خدمة')
    addButton.title = activeMainSection === 'customers' ? 'إضافة زبون' : 'إضافة خدمة'
  }
  if (exportButton) exportButton.hidden = activeMainSection !== 'services'
  if (activeMainSection === 'services') {
    head.innerHTML = `الخدمات والأسعار <span id="service-count"></span>`
    content.innerHTML = '<section class="service-list" id="services-shell-list"></section>'
    updateServicesShell()
  } else if (activeMainSection === 'customers') {
    head.innerHTML = `الزبائن <span id="service-count"></span>`
    renderCustomersSection()
  } else {
    head.innerHTML = `سجل الفواتير <span id="service-count"></span>`
    renderInvoicesSection()
  }
  document.querySelectorAll<HTMLButtonElement>('[data-main-section]').forEach((button) => {
    button.classList.toggle('active', button.dataset.mainSection === activeMainSection)
  })
}

function renderProductsShell() {
  applyTheme(settings.darkMode)
  appRoot.innerHTML = `
    <main class="products-page">
      <header class="topbar">
        <div class="search-box">${svg('search')}<input id="main-search" type="search" placeholder="ابحث عن خدمة..." autocomplete="off"></div>
        <button class="icon-button add-button" id="main-add" aria-label="إضافة">${svg('plus')}</button>
        <button class="icon-button" id="open-export" aria-label="تجهيز فاتورة" title="تجهيز فاتورة">${svg('invoice')}</button>
        <button class="icon-button" id="open-settings" aria-label="الإعدادات">${svg('settings')}</button>
      </header>
      <nav class="main-sections" aria-label="الأقسام">
        <button type="button" data-main-section="services" class="active">الخدمات والأسعار</button>
        <button type="button" data-main-section="customers">الزبائن</button>
        <button type="button" data-main-section="invoices">سجل الفواتير</button>
      </nav>
      <section class="list-head" id="main-section-head"><h1>الخدمات والأسعار <span id="service-count"></span></h1></section>
      <section id="main-section-content"><section class="service-list" id="services-shell-list"></section></section>
    </main>`
  document.querySelector<HTMLInputElement>('#main-search')!.addEventListener('input', () => {
    if (activeMainSection === 'services') updateServicesShell()
    else if (activeMainSection === 'customers') renderCustomersSection()
    else renderInvoicesSection()
  })
  document.querySelector('#main-add')!.addEventListener('click', () => {
    if (activeMainSection === 'customers') renderCustomerEditor()
    else renderServiceEditor()
  })
  document.querySelector('#open-export')!.addEventListener('click', () => renderExportDialog())
  document.querySelector('#open-settings')!.addEventListener('click', renderSettings)
  document.querySelectorAll<HTMLButtonElement>('[data-main-section]').forEach((button) => {
    button.addEventListener('click', () => {
      const section = button.dataset.mainSection as MainSection | undefined
      if (!section || section === activeMainSection) return
      activeMainSection = section
      renderActiveSection()
    })
  })
  renderActiveSection()
}

function renderCustomerEditor(existing?: Customer) {
  if (!currentUser) return
  const element = modal(`
    <button class="modal-close" aria-label="إغلاق">${svg('close')}</button>
    <p class="eyebrow">${existing ? 'تعديل الزبون' : 'زبون جديد'}</p>
    <h2>${existing ? escapeHtml(existing.name) : 'إضافة زبون'}</h2>
    <form id="customer-form" class="service-form">
      <label>اسم الزبون<input name="name" maxlength="100" required value="${existing ? escapeHtml(existing.name) : ''}" placeholder="اسم الزبون"></label>
      <label>رقم الهاتف<input name="phone" type="tel" maxlength="30" value="${existing ? escapeHtml(existing.phone) : ''}" placeholder="رقم الهاتف"></label>
      <label>العنوان<input name="address" maxlength="150" value="${existing ? escapeHtml(existing.address) : ''}" placeholder="عنوان الزبون"></label>
      <label>ملاحظات<textarea name="notes" maxlength="400" rows="3" placeholder="ملاحظات">${existing ? escapeHtml(existing.notes) : ''}</textarea></label>
      <p class="modal-error" id="customer-error"></p>
      <div class="modal-actions">
        ${existing ? '<button class="danger-button" id="delete-customer" type="button">حذف الزبون</button>' : '<button class="secondary-button" id="cancel-customer" type="button">إلغاء</button>'}
        <button class="primary-button" type="submit">${existing ? 'حفظ التعديل' : 'حفظ الزبون'}</button>
      </div>
    </form>`)
  element.querySelector('.modal-close')!.addEventListener('click', () => element.remove())
  element.querySelector('#cancel-customer')?.addEventListener('click', () => element.remove())
  const form = element.querySelector<HTMLFormElement>('#customer-form')!
  let deleteConfirmationActive = false
  form.addEventListener('submit', async (event) => {
    event.preventDefault()
    const error = element.querySelector<HTMLElement>('#customer-error')!
    if (existing && deleteConfirmationActive) {
      const submit = form.querySelector<HTMLButtonElement>('button[type="submit"]')!
      submit.disabled = true
      try {
        await deleteDoc(doc(db, 'users', dataUserId, 'customers', existing.id))
        element.remove()
      } catch (deleteError) {
        submit.disabled = false
        error.textContent = friendlyError(deleteError)
      }
      return
    }
    const data = new FormData(form)
    const name = String(data.get('name') || '').trim()
    const phone = String(data.get('phone') || '').trim()
    const address = String(data.get('address') || '').trim()
    const notes = String(data.get('notes') || '').trim()
    if (!name) { error.textContent = 'أدخل اسم الزبون.'; return }
    const identityMatch = findCustomerIdentityMatch(name, phone, address, existing?.id)
    if (identityMatch) {
      error.textContent = customerIdentityMessage(identityMatch, 'customer')
      return
    }
    const now = new Date().toISOString()
    const documentData = {
      name,
      phone,
      address,
      notes,
      createdAt: existing?.createdAt || now,
      updatedAt: now,
    }
    const submit = form.querySelector<HTMLButtonElement>('button[type="submit"]')!
    submit.disabled = true
    try {
      if (existing) await updateDoc(doc(db, 'users', dataUserId, 'customers', existing.id), documentData)
      else await addDoc(collection(db, 'users', dataUserId, 'customers'), documentData)
      element.remove()
    } catch (saveError) {
      submit.disabled = false
      error.textContent = friendlyError(saveError)
    }
  })
  element.querySelector('#delete-customer')?.addEventListener('click', () => {
    if (!existing) return
    const deleteButton = element.querySelector<HTMLButtonElement>('#delete-customer')!
    const submitButton = form.querySelector<HTMLButtonElement>('button[type="submit"]')!
    deleteConfirmationActive = !deleteConfirmationActive
    if (deleteConfirmationActive) {
      deleteButton.textContent = 'إلغاء'
      deleteButton.className = 'secondary-button cancel-delete-confirm'
      submitButton.textContent = 'تأكيد الحذف'
      submitButton.className = 'danger-button confirm-delete-button'
      element.querySelector('#customer-error')!.textContent = 'اضغط تأكيد الحذف لحذف هذا الزبون نهائيًا.'
      return
    }
    deleteButton.textContent = 'حذف الزبون'
    deleteButton.className = 'danger-button'
    submitButton.textContent = 'حفظ التعديل'
    submitButton.className = 'primary-button'
    element.querySelector('#customer-error')!.textContent = ''
  })
}

function renderAddInvoicePaymentDialog(sourceRecord: InvoiceRecord) {
  const fixedInvoiceNumber = sourceRecord.rootInvoiceNumber || sourceRecord.invoiceNumber
  const remaining = getInvoiceRemainingTotal(sourceRecord)
  const element = modal(`
    <button class="modal-close" aria-label="إغلاق">${svg('close')}</button>
    <p class="eyebrow">إضافة دفعة</p>
    <h2>فاتورة رقم ${escapeHtml(fixedInvoiceNumber)}</h2>
    <form id="invoice-payment-form" class="service-form" novalidate>
      <label>مبلغ الدفعة بالدولار<input name="amount" type="number" min="0.01" max="${remaining}" step="0.01" inputmode="decimal" required placeholder="0.00"><small>المبلغ المتبقي الحالي: ${money(remaining)} دولار</small></label>
      <label>تاريخ الدفعة<input name="date" type="date" value="${new Date().toISOString().slice(0, 10)}"></label>
      <label>ملاحظة<textarea name="note" maxlength="200" rows="2" placeholder="ملاحظة اختيارية"></textarea></label>
      <p class="modal-note">سيتم تسجيل الدفعة في سجل الفاتورة دون تصدير ملف. يمكنك تصدير الفاتورة لاحقًا من زر «تصدير».</p>
      <p class="modal-error" id="invoice-payment-error"></p>
      <div class="modal-actions">
        <button class="secondary-button" id="cancel-invoice-payment" type="button">إلغاء</button>
        <button class="primary-button" id="confirm-invoice-payment" type="submit">حفظ الدفعة</button>
      </div>
    </form>`)
  const close = () => element.remove()
  element.querySelector('.modal-close')!.addEventListener('click', close)
  element.querySelector('#cancel-invoice-payment')!.addEventListener('click', close)

  const form = element.querySelector<HTMLFormElement>('#invoice-payment-form')!
  const error = element.querySelector<HTMLElement>('#invoice-payment-error')!
  const submit = element.querySelector<HTMLButtonElement>('#confirm-invoice-payment')!
  const amountInput = form.querySelector<HTMLInputElement>('input[name="amount"]')!
  const dateInput = form.querySelector<HTMLInputElement>('input[name="date"]')!
  const noteInput = form.querySelector<HTMLTextAreaElement>('textarea[name="note"]')!

  form.addEventListener('submit', async (event) => {
    event.preventDefault()
    if (!currentUser) return
    const ownerId = dataUserId
    const amount = Number(amountInput.value)
    if (!Number.isFinite(amount) || amount <= 0) {
      error.textContent = 'أدخل مبلغ دفعة صحيحًا أكبر من صفر.'
      return
    }
    if (remaining <= 0.00001) {
      error.textContent = 'هذه الفاتورة مسددة بالكامل ولا يمكن إضافة دفعة جديدة.'
      return
    }
    if (amount - remaining > 0.00001) {
      error.textContent = `لا يمكن أن تتجاوز الدفعة المبلغ المتبقي (${money(remaining)} دولار).`
      return
    }
    const paymentDate = dateInput.value || new Date().toISOString().slice(0, 10)
    const note = noteInput.value.trim()
    const payments = [...sourceRecord.payments.map((payment) => ({ ...payment })), {
      amount: Number(amount.toFixed(2)),
      date: paymentDate,
      note,
      createdAt: new Date().toISOString(),
    }]
    const data = invoiceRecordToExportData(sourceRecord)
    data.payments = payments.map((payment) => ({ ...payment }))
    const lastPayment = payments[payments.length - 1]
    data.upfrontPayment = lastPayment ? lastPayment.amount : null
    data.upfrontPaymentDate = lastPayment?.date || data.upfrontPaymentDate
    error.textContent = ''
    submit.disabled = true
    try {
      await saveExportedInvoiceRecord(ownerId, data, getInvoiceRecordEditableItems(sourceRecord), { sourceRecord, payments })
      close()
      showToast('تم تسجيل الدفعة في سجل الفاتورة.')
      window.setTimeout(() => renderInvoiceVersionsDialog(sourceRecord.rootId), 200)
    } catch (saveError) {
      console.error('Failed to save invoice payment:', saveError)
      error.textContent = friendlyError(saveError)
      submit.disabled = false
    }
  })
}

function renderInvoiceExportSnapshotDialog(record: InvoiceRecord) {
  if (!currentUser) return
  const data = invoiceRecordToExportData(record)
  openInvoiceCustomerExportDialog(data, dataUserId, {
    sourceRecord: record,
    editableItems: getInvoiceRecordEditableItems(record),
    payments: record.payments.map((payment) => ({ ...payment })),
    mode: 'export-only',
  })
}

async function saveInvoicePaymentsSnapshot(sourceRecord: InvoiceRecord, payments: InvoicePayment[], successMessage: string) {
  if (!currentUser) return false
  const ownerId = dataUserId
  const netTotal = getInvoiceNetTotal(sourceRecord)
  const paidTotal = payments.reduce((sum, payment) => sum + (Number.isFinite(payment.amount) ? payment.amount : 0), 0)
  if (paidTotal - netTotal > 0.00001) {
    showToast(`لا يمكن أن يتجاوز مجموع الدفعات صافي الفاتورة (${money(netTotal)} دولار).`)
    return false
  }
  const normalizedPayments = payments.map((payment) => ({
    amount: Number((Number.isFinite(payment.amount) ? payment.amount : 0).toFixed(2)),
    date: payment.date || '',
    note: (payment.note || '').trim(),
    createdAt: payment.createdAt || '',
  }))
  const data = invoiceRecordToExportData(sourceRecord)
  data.payments = normalizedPayments.map((payment) => ({ ...payment }))
  const lastPayment = normalizedPayments[normalizedPayments.length - 1]
  data.upfrontPayment = lastPayment ? lastPayment.amount : null
  data.upfrontPaymentDate = lastPayment?.date || ''
  try {
    await saveExportedInvoiceRecord(ownerId, data, getInvoiceRecordEditableItems(sourceRecord), { sourceRecord, payments: normalizedPayments })
    showToast(successMessage)
    return true
  } catch (error) {
    console.error('Failed to save invoice payments snapshot:', error)
    showToast(friendlyError(error))
    return false
  }
}

function renderEditInvoicePaymentDialog(sourceRecord: InvoiceRecord, paymentIndex: number) {
  const payment = sourceRecord.payments[paymentIndex]
  if (!payment) {
    showToast('تعذر العثور على هذه الدفعة.')
    return
  }
  const fixedInvoiceNumber = sourceRecord.rootInvoiceNumber || sourceRecord.invoiceNumber
  const netTotal = getInvoiceNetTotal(sourceRecord)
  const otherPaid = sourceRecord.payments.reduce((sum, item, index) => index === paymentIndex ? sum : sum + (Number.isFinite(item.amount) ? item.amount : 0), 0)
  const maxAmount = Math.max(0, Number((netTotal - otherPaid).toFixed(2)))
  const element = modal(`
    <button class="modal-close" aria-label="إغلاق">${svg('close')}</button>
    <p class="eyebrow">تعديل دفعة</p>
    <h2>فاتورة رقم ${escapeHtml(fixedInvoiceNumber)}</h2>
    <form id="edit-invoice-payment-form" class="service-form" novalidate>
      <label>مبلغ الدفعة بالدولار<input name="amount" type="number" min="0.01" max="${maxAmount}" step="0.01" inputmode="decimal" required value="${escapeHtml(String(payment.amount))}"><small>الحد الأقصى لهذه الدفعة الآن: ${money(maxAmount)} دولار</small></label>
      <label>تاريخ الدفعة<input name="date" type="date" value="${escapeHtml(payment.date || '')}"></label>
      <label>ملاحظة<textarea name="note" maxlength="200" rows="2">${escapeHtml(payment.note || '')}</textarea></label>
      <p class="modal-error" id="edit-invoice-payment-error"></p>
      <div class="modal-actions">
        <button class="secondary-button" id="cancel-edit-invoice-payment" type="button">إلغاء</button>
        <button class="primary-button" type="submit">حفظ التعديل</button>
      </div>
    </form>`)
  const close = () => element.remove()
  element.querySelector('.modal-close')!.addEventListener('click', close)
  element.querySelector('#cancel-edit-invoice-payment')!.addEventListener('click', close)
  const form = element.querySelector<HTMLFormElement>('#edit-invoice-payment-form')!
  const error = element.querySelector<HTMLElement>('#edit-invoice-payment-error')!
  const submit = form.querySelector<HTMLButtonElement>('button[type="submit"]')!
  form.addEventListener('submit', async (event) => {
    event.preventDefault()
    const amount = Number((form.querySelector<HTMLInputElement>('input[name="amount"]')!).value)
    if (!Number.isFinite(amount) || amount <= 0) {
      error.textContent = 'أدخل مبلغ دفعة صحيحًا أكبر من صفر.'
      return
    }
    if (amount - maxAmount > 0.00001) {
      error.textContent = `لا يمكن أن تتجاوز هذه الدفعة ${money(maxAmount)} دولار حتى لا يتجاوز مجموع الدفعات صافي الفاتورة.`
      return
    }
    const date = (form.querySelector<HTMLInputElement>('input[name="date"]')!).value || ''
    const note = (form.querySelector<HTMLTextAreaElement>('textarea[name="note"]')!).value.trim()
    const payments = sourceRecord.payments.map((item, index) => index === paymentIndex
      ? { ...item, amount: Number(amount.toFixed(2)), date, note }
      : { ...item })
    submit.disabled = true
    const saved = await saveInvoicePaymentsSnapshot(sourceRecord, payments, 'تم تحديث الدفعة بنجاح.')
    if (saved) {
      close()
      window.setTimeout(() => renderInvoiceVersionsDialog(sourceRecord.rootId), 200)
    } else submit.disabled = false
  })
}

function renderDeleteInvoicePaymentDialog(sourceRecord: InvoiceRecord, paymentIndex: number) {
  const payment = sourceRecord.payments[paymentIndex]
  if (!payment) {
    showToast('تعذر العثور على هذه الدفعة.')
    return
  }
  const element = modal(`
    <button class="modal-close" aria-label="إغلاق">${svg('close')}</button>
    <p class="eyebrow">حذف دفعة</p>
    <h2>تأكيد حذف الدفعة</h2>
    <p>سيتم حذف الدفعة بمبلغ <strong>${money(payment.amount)} دولار</strong>${payment.date ? ` بتاريخ ${escapeHtml(payment.date)}` : ''} وتحديث المتبقي وحالة الفاتورة الأساسية.</p>
    <p class="modal-error" id="delete-invoice-payment-error"></p>
    <div class="modal-actions">
      <button class="secondary-button" id="cancel-delete-invoice-payment" type="button">إلغاء</button>
      <button class="danger-button" id="confirm-delete-invoice-payment" type="button">حذف الدفعة</button>
    </div>`)
  const close = () => element.remove()
  element.querySelector('.modal-close')!.addEventListener('click', close)
  element.querySelector('#cancel-delete-invoice-payment')!.addEventListener('click', close)
  element.querySelector<HTMLButtonElement>('#confirm-delete-invoice-payment')!.addEventListener('click', async (event) => {
    const button = event.currentTarget as HTMLButtonElement
    button.disabled = true
    const payments = sourceRecord.payments.filter((_, index) => index !== paymentIndex).map((item) => ({ ...item }))
    const saved = await saveInvoicePaymentsSnapshot(sourceRecord, payments, 'تم حذف الدفعة وتحديث حالة الفاتورة.')
    if (saved) {
      close()
      window.setTimeout(() => renderInvoiceVersionsDialog(sourceRecord.rootId), 200)
    } else button.disabled = false
  })
}

function renderInvoiceCorrectionLogDialog(rootId: string) {
  const versions = getInvoiceRootVersions(rootId)
  const corrections = versions
    .map((version, index) => {
      if (index === 0) return null
      const previous = versions[index - 1]
      const changed = invoiceTermsSignature(version) !== invoiceTermsSignature(previous) || paymentsSignature(version) !== paymentsSignature(previous)
      return changed ? describeInvoiceCorrection(previous, version) : null
    })
    .filter((entry): entry is CorrectionEntry => Boolean(entry))
    .reverse()
  const root = versions[0]
  const number = root?.rootInvoiceNumber || root?.invoiceNumber || ''
  const element = modal(`
    <button class="modal-close" aria-label="إغلاق">${svg('close')}</button>
    <p class="eyebrow">سجل التعديلات والحركات</p>
    <h2>الفاتورة رقم ${escapeHtml(number)}</h2>
    <p class="modal-note">يعرض هذا السجل جميع التغييرات على الفاتورة بشكل مبسّط: تعديلات الفاتورة الأساسية (الخدمات، الخصم، البيانات) وحركات الدفعات (إضافة/تعديل/حذف) مع توضيح ما قبل وما بعد.</p>
    <section class="invoice-corrections-timeline">
      ${corrections.length ? corrections.map((entry) => `
        <article class="correction-entry">
          <div class="correction-entry-head">
            <div class="correction-entry-title">
              <strong>${escapeHtml(entry.summary)}</strong>
              <span class="correction-entry-time">${escapeHtml(entry.when || 'بدون وقت')}</span>
            </div>
            ${entry.tags.length ? `<div class="correction-tags">${entry.tags.map((tag) => `<span class="correction-tag">${escapeHtml(tag)}</span>`).join('')}</div>` : ''}
          </div>
          <ul class="correction-changes">
            ${entry.changes.map((change) => `
              <li class="correction-change">
                <span class="correction-change-label">${escapeHtml(change.label)}</span>
                ${change.text
                  ? `<span class="correction-change-text">${escapeHtml(change.text)}</span>`
                  : `<span class="correction-change-diff"><span class="before">${escapeHtml(change.before || '—')}</span><span class="arrow" aria-hidden="true">←</span><span class="after">${escapeHtml(change.after || '—')}</span></span>`}
              </li>`).join('')}
          </ul>
        </article>`).join('') : `
        <div class="empty-state correction-empty-state">
          <strong>لا توجد تعديلات أو حركات مسجلة بعد</strong>
          <p>أي تغيير على الخدمات أو الخصم أو البيانات، أو أي إضافة/تعديل/حذف لدفعة، سيظهر هنا مع توضيح ما قبل وما بعد.</p>
        </div>`}
    </section>`)
  const modalSection = element.querySelector<HTMLElement>('.modal')!
  modalSection.classList.add('invoice-history-modal')
  element.querySelector('.modal-close')!.addEventListener('click', () => element.remove())
}

function renderInvoiceVersionsDialog(rootId: string) {
  const versions = getInvoiceRootVersions(rootId)
  if (!versions.length) {
    showToast('تعذر العثور على هذه الفاتورة.')
    return
  }
  const root = versions[0]
  const latest = versions[versions.length - 1]
  const payments = latest.payments
  const paymentEntries = payments.map((payment, index) => ({ payment, index })).reverse()
  const paymentsTotal = getInvoicePaidTotal(latest)
  const remaining = getInvoiceRemainingTotal(latest)
  const status = getInvoicePaymentStatus(latest)
  const net = getInvoiceNetTotal(latest)
  const element = modal(`
    <button class="modal-close" aria-label="إغلاق">${svg('close')}</button>
    <p class="eyebrow">الفاتورة</p>
    <h2>الفاتورة رقم ${escapeHtml(root.rootInvoiceNumber || root.invoiceNumber)}</h2>
    <div class="invoice-history-shell invoice-base-shell">
      <section class="invoice-versions-list">
        <article class="invoice-version-card is-original invoice-base-card">
          <div class="invoice-version-head">
            <strong>الفاتورة رقم ${escapeHtml(latest.invoiceNumber)}</strong>
            <button class="secondary-button invoice-corrections-log-button" type="button" id="invoice-corrections-log" title="سجل التعديلات والحركات">سجل الحركات</button>
          </div>
          <p>${escapeHtml(latest.customerName || 'بدون اسم زبون')}${latest.customerPhone ? ` — ${escapeHtml(latest.customerPhone)}` : ''}${latest.customerAddress ? ` — ${escapeHtml(latest.customerAddress)}` : ''}</p>
          ${latest.responsibleTeacherName ? `<p>المعلم المسؤول: ${escapeHtml(latest.responsibleTeacherName)}</p>` : ''}
          <p>الإجمالي: ${money(latest.total)} دولار${latest.discount ? ` | الخصم: ${money(latest.discount.amount)} دولار` : ''} | الصافي: ${money(net)} دولار</p>
          <p>المدفوع: ${money(paymentsTotal)} دولار | المتبقي: ${money(remaining)} دولار</p>
          <p><span class="invoice-status-badge is-${status.key}" style="position:static;display:inline-block;">${escapeHtml(status.label)}</span></p>
        </article>

        <div class="invoice-ledger-section">
          <div class="invoice-ledger-head">
            <strong>سجلات الدفعات</strong>
            <button class="secondary-button" type="button" id="invoice-add-payment-entry"${remaining <= 0.00001 ? ' disabled' : ''}>إضافة دفعة</button>
          </div>
          ${paymentEntries.length ? `<div class="invoice-payment-records">${paymentEntries.map(({ payment, index }) => `
            <article class="invoice-payment-record">
              <div class="invoice-payment-record-main">
                <strong>${money(payment.amount)} دولار</strong>
                <span>${escapeHtml(payment.date || 'بدون تاريخ')}${payment.note ? ` — ${escapeHtml(payment.note)}` : ''}</span>
              </div>
              <div class="invoice-payment-record-actions">
                <button class="secondary-button" type="button" data-edit-payment="${index}">تعديل</button>
                <button class="danger-button" type="button" data-delete-payment="${index}">حذف</button>
              </div>
            </article>`).join('')}</div>` : '<p class="empty-state">لا توجد دفعات مسجلة بعد.</p>'}
        </div>
      </section>
      <div class="invoice-history-footer">
        <button class="secondary-button" type="button" id="invoice-history-export">تصدير الفاتورة</button>
        <button class="primary-button" type="button" id="invoice-history-correct">تعديل الفاتورة الأساسية</button>
      </div>
    </div>`)
  const modalSection = element.querySelector<HTMLElement>('.modal')!
  modalSection.classList.add('invoice-history-modal')
  element.querySelector('.modal-close')!.addEventListener('click', () => element.remove())

  const reopen = () => renderInvoiceVersionsDialog(rootId)
  element.querySelector<HTMLButtonElement>('#invoice-add-payment-entry')!.addEventListener('click', () => {
    element.remove()
    renderAddInvoicePaymentDialog(latest)
  })
  element.querySelectorAll<HTMLButtonElement>('[data-edit-payment]').forEach((button) => {
    button.addEventListener('click', () => {
      const index = Number(button.dataset.editPayment)
      element.remove()
      renderEditInvoicePaymentDialog(latest, index)
      // reopen handled by user flow; snapshots will refresh state
    })
  })
  element.querySelectorAll<HTMLButtonElement>('[data-delete-payment]').forEach((button) => {
    button.addEventListener('click', () => {
      const index = Number(button.dataset.deletePayment)
      element.remove()
      renderDeleteInvoicePaymentDialog(latest, index)
    })
  })
  element.querySelector<HTMLButtonElement>('#invoice-corrections-log')!.addEventListener('click', () => {
    renderInvoiceCorrectionLogDialog(rootId)
  })
  element.querySelector<HTMLButtonElement>('#invoice-history-export')!.addEventListener('click', () => {
    element.remove()
    renderInvoiceExportSnapshotDialog(latest)
  })
  element.querySelector<HTMLButtonElement>('#invoice-history-correct')!.addEventListener('click', () => {
    if (!payments.length && getInvoicePaidTotal(latest) <= 0.00001) {
      element.remove()
      renderExportDialog({ sourceRecord: latest, correction: true })
      return
    }
    const fullyPaid = status.key === 'paid'
    element.remove()
    const confirmModal = modal(`
      <button class="modal-close" aria-label="إغلاق">${svg('close')}</button>
      <p class="eyebrow">تنبيه قبل التعديل</p>
      <h2>${fullyPaid ? 'تعديل فاتورة مسددة بالكامل' : 'تعديل الفاتورة الأساسية'}</h2>
      <p>${fullyPaid
        ? 'هذه الفاتورة مسددة بالكامل. لا يمكن حفظ أي تعديل (خصم/خدمات/إلغاء خدمة) إذا جعل صافي الفاتورة أقل من إجمالي الدفعات المسجلة.'
        : 'يمكنك تعديل الخصم أو الخدمات من الفاتورة الأساسية. لا يمكن حذف خدمة نهائيًا، لكن يمكنك إلغاءها لتظهر مشطوبة ولا تُحتسب ضمن الإجمالي. لن يُحفظ التعديل إذا أصبح الصافي أقل من إجمالي الدفعات.'}</p>
      <div class="modal-actions">
        <button class="secondary-button" type="button" id="cancel-correct-base">إلغاء</button>
        <button class="primary-button" type="button" id="confirm-correct-base">متابعة التعديل</button>
      </div>`)
    const closeConfirm = () => { confirmModal.remove(); reopen() }
    confirmModal.querySelector('.modal-close')!.addEventListener('click', closeConfirm)
    confirmModal.querySelector('#cancel-correct-base')!.addEventListener('click', closeConfirm)
    confirmModal.querySelector('#confirm-correct-base')!.addEventListener('click', () => {
      confirmModal.remove()
      renderExportDialog({ sourceRecord: latest, correction: true })
    })
  })
}

function renderServiceEditor(existing?: WorkService) {
  if (!currentUser) return
  const element = modal(`
    <button class="modal-close" aria-label="إغلاق">${svg('close')}</button>
    <p class="eyebrow">${existing ? 'تعديل الخدمة' : 'خدمة جديدة'}</p>
    <h2>${existing ? escapeHtml(existing.name) : 'إضافة خدمة'}</h2>
    <form id="service-form" class="service-form">
      <label>اسم الخدمة<input name="name" maxlength="100" required value="${existing ? escapeHtml(existing.name) : ''}" placeholder="مثال: تركيب السيراميك"></label>
      <label>السعر<input name="price" type="number" min="0" step="0.01" inputmode="decimal" required value="${existing ? existing.price : ''}" placeholder="0.00"></label>
      <div class="custom-select-field" data-custom-select="unit" data-selected="${existing?.unit || 'SQM'}">
        <span class="custom-select-label-title">وحدة القياس</span>
        <button type="button" class="custom-select-trigger" aria-haspopup="listbox" aria-expanded="false">
          <span class="custom-select-value"></span>
          <svg class="custom-select-chevron" viewBox="0 0 24 24" aria-hidden="true"><path d="m7 10 5 5 5-5"/></svg>
        </button>
        <div class="custom-select-menu" role="listbox" hidden>
          <button type="button" class="custom-select-option" role="option" data-value="SQM" data-label="متر مربع">متر مربع</button>
          <button type="button" class="custom-select-option" role="option" data-value="LM" data-label="متر جر">متر جر</button>
          <button type="button" class="custom-select-more" aria-expanded="false">عرض المزيد من وحدات القياس</button>
          <button type="button" class="custom-select-option custom-select-extra" role="option" data-value="CBM" data-label="متر مكعب" hidden>متر مكعب</button>
          <button type="button" class="custom-select-option custom-select-extra" role="option" data-value="PCS" data-label="قطعة / عدد" hidden>قطعة / عدد</button>
          <button type="button" class="custom-select-option custom-select-extra" role="option" data-value="LOT" data-label="مقطوعية" hidden>مقطوعية</button>
          <button type="button" class="custom-select-option custom-select-extra" role="option" data-value="PROJECT" data-label="مشروع" hidden>مشروع</button>
          <button type="button" class="custom-select-option custom-select-extra" role="option" data-value="GROUP" data-label="مجموعة" hidden>مجموعة</button>
        </div>
        <input type="hidden" name="unit" value="${existing?.unit || 'SQM'}">
      </div>
      <label>الوصف الاختياري<textarea name="description" maxlength="300" rows="3" placeholder="تفاصيل الخدمة">${existing ? escapeHtml(existing.description) : ''}</textarea></label>
      <p class="modal-error" id="service-error"></p>
      <div class="modal-actions">
        ${existing ? '<button class="danger-button" id="delete-service" type="button">حذف الخدمة</button>' : '<button class="secondary-button" id="cancel-service" type="button">إلغاء</button>'}
        <button class="primary-button" type="submit">${existing ? 'حفظ التعديل' : 'حفظ الخدمة'}</button>
      </div>
    </form>`)
  element.querySelector('.modal-close')!.addEventListener('click', () => element.remove())
  element.querySelector('#cancel-service')?.addEventListener('click', () => element.remove())
  const form = element.querySelector<HTMLFormElement>('#service-form')!
  form.querySelectorAll<HTMLElement>('[data-custom-select]').forEach((field) => {
    const trigger = field.querySelector<HTMLButtonElement>('.custom-select-trigger')!
    const menu = field.querySelector<HTMLElement>('.custom-select-menu')!
    const valueElement = field.querySelector<HTMLElement>('.custom-select-value')!
    const hiddenInput = field.querySelector<HTMLInputElement>('input[type="hidden"]')!
    const options = [...field.querySelectorAll<HTMLButtonElement>('.custom-select-option')]
    const moreButton = field.querySelector<HTMLButtonElement>('.custom-select-more')
    moreButton?.addEventListener('click', (event) => {
      event.stopPropagation()
      const expanded = moreButton.getAttribute('aria-expanded') === 'true'
      moreButton.setAttribute('aria-expanded', String(!expanded))
      moreButton.textContent = expanded ? 'عرض المزيد من وحدات القياس' : 'عرض وحدات القياس الأساسية'
      field.querySelectorAll<HTMLButtonElement>('.custom-select-extra').forEach((option) => {
        option.hidden = expanded
      })
    })
    const selectedValue = field.dataset.selected
    const selectValue = (option: HTMLButtonElement) => {
      hiddenInput.value = option.dataset.value || ''
      valueElement.textContent = option.dataset.label || ''
      options.forEach((item) => {
        const selected = item === option
        item.classList.toggle('is-selected', selected)
        item.setAttribute('aria-selected', String(selected))
      })
      closeMenu()
    }
    const closeMenu = () => {
      menu.hidden = true
      field.classList.remove('open')
      trigger.setAttribute('aria-expanded', 'false')
    }
    const selectedOption = options.find((option) => option.dataset.value === selectedValue) || options[0]
    selectValue(selectedOption)
    trigger.addEventListener('click', (event) => {
      event.stopPropagation()
      form.querySelectorAll<HTMLElement>('[data-custom-select].open').forEach((openField) => {
        if (openField !== field) {
          openField.classList.remove('open')
          openField.querySelector<HTMLElement>('.custom-select-menu')!.hidden = true
          openField.querySelector<HTMLButtonElement>('.custom-select-trigger')!.setAttribute('aria-expanded', 'false')
        }
      })
      const shouldOpen = menu.hidden === true
      menu.hidden = !shouldOpen
      field.classList.toggle('open', shouldOpen)
      trigger.setAttribute('aria-expanded', String(shouldOpen))
    })
    options.forEach((option) => option.addEventListener('click', (event) => {
      event.stopPropagation()
      selectValue(option)
    }))
  })
  form.addEventListener('submit', async (event) => {
    event.preventDefault()
    if (existing && deleteConfirmationActive) {
      const submit = form.querySelector<HTMLButtonElement>('button[type="submit"]')!
      submit.disabled = true
      try {
        await deleteDoc(doc(db, 'users', dataUserId, 'services', existing.id))
        element.remove()
      } catch (deleteError) {
        submit.disabled = false
        element.querySelector('#service-error')!.textContent = friendlyError(deleteError)
      }
      return
    }
    const data = new FormData(form)
    const name = String(data.get('name') || '').trim()
    const price = Number(data.get('price'))
    const currencyCode = 'USD'
    const unit = String(data.get('unit'))
    const description = String(data.get('description') || '').trim()
    const error = element.querySelector<HTMLElement>('#service-error')!
    if (!name) { error.textContent = 'أدخل اسم الخدمة.'; return }
    if (!Number.isFinite(price) || price < 0) { error.textContent = 'أدخل سعرًا صحيحًا.'; return }
    if (!['SQM', 'LM', 'CBM', 'PCS', 'LOT', 'PROJECT', 'GROUP'].includes(unit)) {
      error.textContent = 'اختر وحدة القياس.'
      return
    }
    const now = new Date().toISOString()
    const documentData = {
      name,
      price,
      currencyCode,
      unit,
      description,
      createdAt: existing?.createdAt || now,
      updatedAt: now,
    }
    const submit = form.querySelector<HTMLButtonElement>('button[type="submit"]')!
    submit.disabled = true
    try {
      if (existing) {
        await updateDoc(doc(db, 'users', dataUserId, 'services', existing.id), documentData)
      } else {
        await addDoc(collection(db, 'users', dataUserId, 'services'), documentData)
      }
      element.remove()
    } catch (saveError) {
      submit.disabled = false
      error.textContent = friendlyError(saveError)
    }
  })
  let deleteConfirmationActive = false
  element.querySelector('#delete-service')?.addEventListener('click', () => {
    if (!existing) return
    const deleteButton = element.querySelector<HTMLButtonElement>('#delete-service')!
    const submitButton = form.querySelector<HTMLButtonElement>('button[type="submit"]')!
    deleteConfirmationActive = !deleteConfirmationActive
    if (deleteConfirmationActive) {
      deleteButton.textContent = 'إلغاء'
      deleteButton.className = 'secondary-button cancel-delete-confirm'
      submitButton.textContent = 'تأكيد الحذف'
      submitButton.className = 'danger-button confirm-delete-button'
      submitButton.disabled = false
      element.querySelector('#service-error')!.textContent = 'اضغط تأكيد الحذف لحذف هذه الخدمة نهائيًا.'
      return
    }
    deleteButton.textContent = 'حذف الخدمة'
    deleteButton.className = 'danger-button'
    submitButton.textContent = 'حفظ التعديل'
    submitButton.className = 'primary-button'
    element.querySelector('#service-error')!.textContent = ''
  })
}

function renderSettings() {
  if (!currentUser) return
  const element = modal(`
    <button class="modal-close" aria-label="إغلاق">${svg('close')}</button>
    <p class="eyebrow">إعدادات التطبيق</p>
    <div class="settings-tabs">
      <button class="active" data-settings-tab="currency">العملة</button>
      <button data-settings-tab="system">النظام</button>
      <button data-settings-tab="backup">نسخ احتياطي</button>
    </div>
    <div id="settings-content"></div>`)
  element.querySelector('.modal-close')!.addEventListener('click', () => element.remove())
  const content = element.querySelector<HTMLElement>('#settings-content')!
  const renderTab = (tab: 'currency' | 'system' | 'backup') => {
    element.querySelectorAll<HTMLButtonElement>('[data-settings-tab]').forEach((button) =>
      button.classList.toggle('active', button.dataset.settingsTab === tab))
    if (tab === 'currency') renderCurrencySettings(content, element)
    if (tab === 'system') renderSystemSettings(content)
    if (tab === 'backup') renderBackupSettings(content)
  }
  element.querySelectorAll<HTMLButtonElement>('[data-settings-tab]').forEach((button) => {
    button.addEventListener('click', () => renderTab(button.dataset.settingsTab as 'currency' | 'system' | 'backup'))
  })
  renderTab('currency')
}

function renderCurrencySettings(content: HTMLElement, element: HTMLElement) {
  content.innerHTML = `
    <h2>العملة</h2>
    <label class="switch-row"><span>تفعيل الليرة السورية</span><input id="local-currency-enabled" type="checkbox" ${settings.syriaEnabled ? 'checked' : ''}><i></i></label>
    <div id="currency-fields" class="${settings.syriaEnabled ? '' : 'hidden'}">
      <label>سعر الصرف<input id="exchange-rate" type="number" min="0.000001" step="0.000001" value="${settings.exchangeRate || ''}" placeholder="15000"><small>1 دولار = عدد الليرات</small></label>
    </div>
    <p class="modal-error" id="currency-error"></p>
    <button class="primary-button" id="save-currency">حفظ إعدادات العملة</button>`
  const enabled = content.querySelector<HTMLInputElement>('#local-currency-enabled')!
  enabled.addEventListener('change', () =>
    content.querySelector('#currency-fields')!.classList.toggle('hidden', !enabled.checked))
  content.querySelector('#save-currency')!.addEventListener('click', async () => {
    if (!currentUser) return
    const exchangeRate = Number(content.querySelector<HTMLInputElement>('#exchange-rate')!.value)
    const error = content.querySelector<HTMLElement>('#currency-error')!
    if (enabled.checked && (!Number.isFinite(exchangeRate) || exchangeRate <= 0)) {
      error.textContent = 'أدخل سعر صرف موجبًا.'
      return
    }
    settings = {
      ...settings,
      syriaEnabled: enabled.checked,
      localCurrencyCode: 'ليرة',
      localCurrencyName: 'ليرة',
      exchangeRate: enabled.checked ? exchangeRate : settings.exchangeRate,
    }
    saveCachedSettings(dataUserId, settings)
    try {
      await setDoc(doc(db, 'users', dataUserId), settings, { merge: true })
      element.remove()
    } catch (saveError) {
      error.textContent = friendlyError(saveError)
    }
  })
}

function renderSystemSettings(content: HTMLElement) {
  content.innerHTML = `
    <h2>النظام</h2>
    <label class="switch-row"><span>الوضع الليلي</span><input id="dark-mode-toggle" type="checkbox" ${settings.darkMode ? 'checked' : ''}><i></i></label>
    <div class="account"><span>${escapeHtml(currentUser?.email || '')}</span><button class="text-button" id="logout" type="button">تسجيل الخروج</button></div>`
  content.querySelector<HTMLInputElement>('#dark-mode-toggle')!.addEventListener('change', async (event) => {
    settings = { ...settings, darkMode: (event.currentTarget as HTMLInputElement).checked }
    applyTheme(settings.darkMode)
    saveCachedSettings(dataUserId, settings)
    try { await setDoc(doc(db, 'users', dataUserId), settings, { merge: true }) } catch { /* Keep local state. */ }
  })
  content.querySelector('#logout')!.addEventListener('click', async () => {
    await signOut(auth)
  })
}

function renderBackupSettings(content: HTMLElement) {
  content.innerHTML = `
    <h2>النسخ الاحتياطي واستعادة البيانات</h2>
    <div class="backup-actions">
      <button class="primary-button" id="create-backup" type="button">تصدير نسخة احتياطية</button>
      <button class="secondary-button" id="choose-restore-backup" type="button">استيراد نسخة احتياطية</button>
      <input id="restore-backup" type="file" accept=".zip,application/zip" hidden>
    </div>
    <p class="modal-error" id="backup-status"></p>`
  content.querySelector('#create-backup')!.addEventListener('click', async () => {
    if (!currentUser) return
    const status = content.querySelector<HTMLElement>('#backup-status')!
    status.textContent = 'جارٍ إنشاء النسخة...'
    try {
      const archive = await createBackupArchive(db, dataUserId, currentUser.uid, {
        syriaEnabled: settings.syriaEnabled,
        exchangeRate: settings.exchangeRate,
        darkMode: settings.darkMode,
        localCurrencyCode: settings.localCurrencyCode,
        localCurrencyName: settings.localCurrencyName,
      })
      const url = URL.createObjectURL(archive)
      const link = document.createElement('a')
      link.href = url
      link.download = `نسخة-احتياطية-أسطح-${new Date().toISOString().slice(0, 10)}.zip`
      document.body.append(link)
      link.click()
      link.remove()
      window.setTimeout(() => URL.revokeObjectURL(url), 1000)
      status.textContent = 'تم إنشاء النسخة وتنزيلها.'
    } catch (backupError) {
      status.textContent = friendlyError(backupError)
    }
  })
  content.querySelector('#choose-restore-backup')!.addEventListener('click', () => {
    content.querySelector<HTMLInputElement>('#restore-backup')!.click()
  })
  content.querySelector<HTMLInputElement>('#restore-backup')!.addEventListener('change', async (event) => {
    const input = event.currentTarget as HTMLInputElement
    const file = input.files?.[0]
    if (!file || !currentUser) return
    const status = content.querySelector<HTMLElement>('#backup-status')!
    status.textContent = 'جارٍ قراءة النسخة...'
    try {
      const backup: ValidatedBackup = await readBackupArchive(file)
      const plan = await prepareRestorePlan(db, backup, dataUserId, currentUser.uid, 'replace' as RestoreMode)
      await executeRestorePlan(db, plan, () => true, () => undefined)
      status.textContent = 'تمت استعادة النسخة بنجاح.'
    } catch (restoreError) {
      status.textContent = restoreError instanceof Error ? restoreError.message : friendlyError(restoreError)
    } finally {
      input.value = ''
    }
  })
}

type ExportServiceRow = {
  service: WorkService
  exportPrice: number
  wasModified: boolean
}

type InvoiceExportRow = {
  name: string
  notes: string
  quantity: number
  unit: string
  unitPrice: number
  total: number
  cancelled?: boolean
}

type InvoiceDiscount = {
  mode: 'percentage' | 'amount'
  value: number
  amount: number
}

type InvoiceExportData = {
  rows: InvoiceExportRow[]
  unitTotals: InvoiceUnitTotal[]
  invoiceNumber: string
  total: number
  discount: InvoiceDiscount | null
  exportFormat: InvoiceExportFormat
  exportDate: string
  customerId: string | null
  customerName: string
  customerPhone: string
  customerAddress: string
  responsibleTeacherName: string
  upfrontPayment: number | null
  upfrontPaymentDate: string
  payments?: InvoicePayment[]
  exportNote?: string
}

function wrapCanvasText(context: CanvasRenderingContext2D, text: string, maxWidth: number) {
  const lines: string[] = []
  let line = ''
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const test = line ? `${line} ${word}` : word
    if (context.measureText(test).width <= maxWidth) {
      line = test
      continue
    }
    if (line) lines.push(line)
    if (context.measureText(word).width <= maxWidth) {
      line = word
      continue
    }
    let fragment = ''
    for (const char of word) {
      const next = fragment + char
      if (context.measureText(next).width <= maxWidth) fragment = next
      else {
        if (fragment) lines.push(fragment)
        fragment = char
      }
    }
    line = fragment
  }
  if (line) lines.push(line)
  return lines.length ? lines : ['']
}

function invoiceCurrencyLabel(currencyCode: string) {
  return currencyCode === 'USD' ? 'دولار' : currencyCode
}

function getFollowingInvoiceNumber(currentNumber: unknown) {
  const current = currentNumber ?? 0
  if (typeof current !== 'number' || !Number.isSafeInteger(current) || current < 0) {
    throw new Error('Invoice counter is invalid')
  }
  const next = current + 1
  if (!Number.isSafeInteger(next)) throw new Error('Invoice counter has reached its limit')
  return next
}

function formatInvoiceNumber(number: number) {
  return String(number).padStart(5, '0')
}

async function getInvoiceNumberCandidate(ownerId: string): Promise<string> {
  if (!ownerId) throw new Error('Invoice owner is unavailable')
  const snapshot = await getDoc(doc(db, 'users', ownerId))
  return formatInvoiceNumber(getFollowingInvoiceNumber(snapshot.get('invoiceCounter')))
}

async function getNextInvoiceNumber(ownerId: string): Promise<string> {
  if (!ownerId) throw new Error('Invoice owner is unavailable')
  const ownerRef = doc(db, 'users', ownerId)
  const nextNumber = await runTransaction(db, async (transaction) => {
    const snapshot = await transaction.get(ownerRef)
    const next = getFollowingInvoiceNumber(snapshot.get('invoiceCounter'))
    transaction.set(ownerRef, { invoiceCounter: next }, { merge: true })
    return next
  })
  return formatInvoiceNumber(nextNumber)
}

function invoicePriceInUsd(service: WorkService): number | null {
  if (service.currencyCode === 'USD') return service.price
  if (!Number.isFinite(settings.exchangeRate) || settings.exchangeRate <= 0) return null
  return Number((service.price / settings.exchangeRate).toFixed(2))
}

function aggregateInvoiceQuantities(
  items: Iterable<{ unit: string; quantity: number; amount: number | null }>,
): InvoiceUnitTotal[] {
  const totals = new Map<string, { quantity: number; amount: number; amountComplete: boolean }>()
  for (const item of items) {
    if (!item.unit.trim() || !Number.isFinite(item.quantity) || item.quantity <= 0) continue
    const current = totals.get(item.unit) ?? { quantity: 0, amount: 0, amountComplete: true }
    const quantity = current.quantity + item.quantity
    if (!Number.isFinite(quantity)) continue
    const amountIsValid = item.amount !== null && Number.isFinite(item.amount) && item.amount >= 0
    const amount = amountIsValid ? current.amount + (item.amount ?? 0) : current.amount
    totals.set(item.unit, {
      quantity,
      amount: Number.isFinite(amount) ? amount : current.amount,
      amountComplete: current.amountComplete && amountIsValid && Number.isFinite(amount),
    })
  }
  return [...totals].map(([unit, total]) => ({
    unit,
    quantity: total.quantity,
    amount: total.amountComplete ? total.amount : null,
  }))
}

function customerDetailsSegments(details: {
  customerName?: string
  customerPhone?: string
  customerAddress?: string
}) {
  const segments: Array<{ text: string; red: boolean }> = []
  const customerName = details.customerName?.trim()
  const customerPhone = details.customerPhone?.trim()
  const customerAddress = details.customerAddress?.trim()
  if (customerName) {
    segments.push(
      { text: 'مقدمة إلى السيد ', red: false },
      { text: customerName, red: true },
      { text: ' المحترم', red: false },
    )
  }
  if (customerPhone) {
    if (segments.length) segments.push({ text: ' | ', red: false })
    segments.push(
      { text: 'الهاتف: ', red: false },
      { text: customerPhone, red: true },
    )
  }
  if (customerAddress) {
    if (segments.length) segments.push({ text: ' | ', red: false })
    segments.push(
      { text: 'العنوان: ', red: false },
      { text: customerAddress, red: true },
    )
  }
  return segments
}

function responsibleTeacherSegments(name?: string) {
  const responsibleTeacherName = name?.trim()
  return responsibleTeacherName
    ? [
      { text: 'المعلم المسؤول عن التنفيذ: ', red: false },
      { text: responsibleTeacherName, red: true },
    ]
    : []
}

function drawDetailSegments(
  context: CanvasRenderingContext2D,
  width: number,
  y: number,
  segments: Array<{ text: string; red: boolean }>,
) {
  if (!segments.length) return
  context.font = '600 14px "Cairo", sans-serif'
  const detailWidth = segments.reduce((total, segment) =>
    total + context.measureText(segment.text).width, 0)
  const detailScale = Math.min(1, 760 / detailWidth)
  context.save()
  context.translate(width / 2, 0)
  context.scale(detailScale, 1)
  let detailX = detailWidth / 2
  context.direction = 'rtl'
  context.textAlign = 'right'
  segments.forEach((segment) => {
    context.fillStyle = segment.red ? '#c96a6a' : '#718096'
    context.fillText(segment.text, detailX, y)
    detailX -= context.measureText(segment.text).width
  })
  context.restore()
}

function drawCustomerDetails(
  context: CanvasRenderingContext2D,
  width: number,
  y: number,
  details: { customerName?: string; customerPhone?: string; customerAddress?: string },
) {
  drawDetailSegments(context, width, y, customerDetailsSegments(details))
}

async function exportServicesToExcel(button: HTMLButtonElement, rows: ExportServiceRow[]) {
  if (!rows.length) {
    showToast('لا توجد خدمات محددة للتصدير.')
    return
  }
  button.disabled = true
  try {
    const ExcelJS = await import('exceljs')
    const workbook = new ExcelJS.Workbook()
    const worksheet = workbook.addWorksheet('الخدمات', {
      views: [{ rightToLeft: true }],
      pageSetup: { orientation: 'portrait', fitToPage: true, fitToWidth: 1 },
    })
    worksheet.columns = [
      { header: 'اسم الخدمة', key: 'name', width: 32 },
      { header: 'السعر', key: 'price', width: 16 },
      { header: 'العملة', key: 'currency', width: 16 },
      { header: 'الوحدة', key: 'unit', width: 20 },
      { header: 'الوصف', key: 'description', width: 38 },
    ]
    worksheet.addRows(rows.map(({ service, exportPrice }) => ({
      name: service.name,
      price: exportPrice,
      currency: service.currencyCode === 'USD' ? 'دولار' : service.currencyCode,
      unit: serviceUnitLabel(service.unit),
      description: service.description,
    })))
    worksheet.eachRow((row, rowNumber) => {
      row.height = rowNumber === 1 ? 28 : 24
      row.eachCell({ includeEmpty: true }, (cell) => {
        cell.alignment = { horizontal: 'right', vertical: 'middle' }
        cell.font = { name: 'Arial', size: rowNumber === 1 ? 12 : 11, bold: rowNumber === 1, color: { argb: rowNumber === 1 ? 'FFFFFFFF' : 'FF203044' } }
        if (rowNumber === 1) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF007D79' } }
      })
    })
    worksheet.getColumn('price').numFmt = '0.00'
    worksheet.autoFilter = { from: 'A1', to: 'E1' }
    const buffer = await workbook.xlsx.writeBuffer()
    const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `قائمة-الخدمات-${new Date().toISOString().slice(0, 10)}.xlsx`
    document.body.append(link)
    link.click()
    link.remove()
    window.setTimeout(() => URL.revokeObjectURL(url), 1000)
    showToast('تم تصدير قائمة الخدمات كملف Excel.')
  } catch (error) {
    console.error('Failed to export services Excel:', error)
    showToast('تعذر تصدير Excel. حاول مجددًا.')
  } finally {
    button.disabled = false
  }
}

async function exportServicesToImage(
  button: HTMLButtonElement,
  imageScale: 1 | 2,
  rows: ExportServiceRow[],
  options: { customerName?: string; customerPhone?: string; customerAddress?: string; previewOnly?: boolean } = {},
) {
  if (!rows.length) {
    showToast('لا توجد خدمات محددة للتصدير.')
    return
  }
  button.disabled = true
  try {
    await document.fonts.ready
    await Promise.all([
      document.fonts.load('600 20px Cairo'),
      document.fonts.load('700 20px Cairo'),
      document.fonts.load('800 20px Cairo'),
    ])
    const width = 840
    const height = 1188
    const pageSize = 20
    const tableTop = 232
    const headerHeight = 50
    const rowHeight = 40
    const tableLeft = 40
    const tableWidth = 760
    const pageCount = Math.ceil(rows.length / pageSize)
    const exportDateValue = new Date()
    const exportDate = exportDateValue.toISOString().slice(0, 10)
    const dateDay = String(exportDateValue.getDate()).padStart(2, '0')
    const dateMonth = String(exportDateValue.getMonth() + 1).padStart(2, '0')
    const dateYear = String(exportDateValue.getFullYear())
    const arabicDate = `${dateDay}/${dateMonth}/${dateYear}`
    const customerName = options.customerName?.trim()
    const customerPhone = options.customerPhone?.trim()
    const customerAddress = options.customerAddress?.trim()

    const previewUrls: string[] = []
    for (let pageIndex = 0; pageIndex < pageCount; pageIndex += 1) {
      const canvas = document.createElement('canvas')
      canvas.width = width * imageScale
      canvas.height = height * imageScale
      const context = canvas.getContext('2d')
      if (!context) throw new Error('Canvas unavailable')
      context.scale(imageScale, imageScale)
      context.fillStyle = '#fbfcfc'
      context.fillRect(0, 0, width, height)
      context.direction = 'rtl'

      context.fillStyle = '#007d79'
      context.fillRect(0, 0, width, 12)
      context.textAlign = 'center'
      context.fillStyle = '#007d79'
      context.font = '800 34px "Cairo", sans-serif'
      context.fillText('الكردي لأعمال البلاط والسيراميك والرخام', width / 2, 82)

      context.fillStyle = '#203044'
      context.font = '800 20px "Cairo", sans-serif'
      context.fillText('قائمة أسعار الخدمات المتوفرة لدينا', width / 2, 125)

      drawCustomerDetails(context, width, 155, { customerName, customerPhone, customerAddress })

      context.direction = 'rtl'
      context.textAlign = 'center'
      context.fillStyle = '#c96a6a'
      context.font = '600 14px "Cairo", sans-serif'
      context.fillText(`التاريخ: ${arabicDate}`, width / 2, 178)
      context.strokeStyle = '#b7d7d3'
      context.lineWidth = 2
      context.beginPath()
      context.moveTo(260, 191)
      context.lineTo(580, 191)
      context.stroke()
      context.fillStyle = '#c96a6a'
      context.textAlign = 'center'
      context.font = '600 12px "Cairo", sans-serif'
      context.fillText(
        'تنويه: هذه قائمة بأسعار الخدمات التي تقدمها شركة الكردي، وليست فاتورةً عن أعمال منفذة.',
        width / 2,
        218,
        tableWidth,
      )

      const columns = [
        { left: 710, right: 800, align: 'center' as const, title: 'م' },
        { left: 330, right: 710, align: 'right' as const, title: 'اسم الخدمة' },
        { left: 190, right: 330, align: 'center' as const, title: 'الوحدة' },
        { left: 40, right: 190, align: 'center' as const, title: 'السعر' },
      ]
      context.fillStyle = '#007d79'
      context.fillRect(tableLeft, tableTop, tableWidth, headerHeight)
      context.fillStyle = '#ffffff'
      context.font = '800 20px "Cairo", sans-serif'
      columns.forEach((column) => {
        context.textAlign = column.align
        const x = column.align === 'right' ? column.right - 14 : (column.left + column.right) / 2
        context.fillText(column.title, x, tableTop + 33)
      })
      context.strokeStyle = '#ffffff'
      context.lineWidth = 1
      columns.forEach((column) => {
        context.beginPath()
        context.moveTo(column.left, tableTop)
        context.lineTo(column.left, tableTop + headerHeight)
        context.stroke()
      })

      context.strokeStyle = '#dfe7e8'
      context.lineWidth = 1
      const pageRows = rows.slice(pageIndex * pageSize, (pageIndex + 1) * pageSize)
      for (let rowIndex = 0; rowIndex < pageSize; rowIndex += 1) {
        const y = tableTop + headerHeight + rowIndex * rowHeight
        context.fillStyle = rowIndex % 2 === 0 ? '#f3f7f7' : '#ffffff'
        context.fillRect(tableLeft, y, tableWidth, rowHeight)
        context.strokeRect(tableLeft, y, tableWidth, rowHeight)
        columns.forEach((column) => {
          context.beginPath()
          context.moveTo(column.left, y)
          context.lineTo(column.left, y + rowHeight)
          context.stroke()
        })

        const row = pageRows[rowIndex]
        if (!row) continue
        const { service, exportPrice } = row

        context.fillStyle = '#203044'
        context.textAlign = 'center'
        context.font = '600 17px "Cairo", sans-serif'
        context.fillText(String(pageIndex * pageSize + rowIndex + 1), 755, y + 27)

        context.textAlign = 'right'
        context.font = '600 17px "Cairo", sans-serif'
        let nameLines = wrapCanvasText(context, service.name, 350)
        if (nameLines.length > 2) {
          for (let size = 16; size >= 12 && nameLines.length > 2; size -= 1) {
            context.font = `600 ${size}px "Cairo", sans-serif`
            nameLines = wrapCanvasText(context, service.name, 350)
          }
        }
        if (nameLines.length === 1) {
          context.fillText(nameLines[0], 696, y + 27)
        } else {
          const startY = y + 20 - (nameLines.length - 1) * 8
          nameLines.forEach((line, lineIndex) => context.fillText(line, 696, startY + lineIndex * 16))
        }

        context.textAlign = 'center'
        context.font = '600 16px "Cairo", sans-serif'
        const unitText = serviceUnitLabel(service.unit)
        context.fillText(unitText, 260, y + 27)

        context.fillStyle = '#007d79'
        context.font = '800 18px "Cairo", sans-serif'
        const currencyText = service.currencyCode === 'USD' ? '$'
          : service.currencyCode === 'ليرة' ? 'ل.س'
          : service.currencyCode
        context.fillText(`${money(exportPrice)} ${currencyText}`, 115, y + 27)
      }

      context.fillStyle = '#203044'
      context.textAlign = 'center'
      context.font = '800 20px "Cairo", sans-serif'
      context.fillText('الكردي لأعمال البلاط والسيراميك والرخام', width / 2, 1115)
      context.fillStyle = '#007d79'
      context.font = '800 18px "Cairo", sans-serif'
      context.fillText('نسعد بخدمتكم', width / 2, 1148)
      if (pageCount > 1) {
        context.fillStyle = '#718096'
        context.textAlign = 'center'
        context.font = '600 14px "Cairo", sans-serif'
        context.fillText(`صفحة ${pageIndex + 1} من ${pageCount}`, width / 2, 1170)
      }

      const blob = await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob((result) => result ? resolve(result) : reject(new Error('Failed to create PNG')), 'image/png')
      })
      if (options.previewOnly) {
        previewUrls.push(canvas.toDataURL('image/png'))
        continue
      }
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      const suffix = pageCount > 1 ? `-صفحة-${pageIndex + 1}-من-${pageCount}` : ''
      link.download = `قائمة-الخدمات-${imageScale === 2 ? 'فائقة-الجودة-' : ''}${exportDate}${suffix}.png`
      document.body.append(link)
      window.setTimeout(() => {
        link.click()
        link.remove()
        URL.revokeObjectURL(url)
      }, pageIndex * 350)
    }
    if (options.previewOnly) return previewUrls
    showToast(pageCount > 1 ? `تم تصدير ${pageCount} صفحات PNG.` : 'تم تصدير قائمة الخدمات كصورة PNG.')
  } catch (error) {
    console.error('Failed to export services image:', error)
    showToast('تعذر تصدير الصورة. حاول مجددًا.')
  } finally {
    button.disabled = false
  }
}

function openImageExportPreview(imageScale: 1 | 2, rows: ExportServiceRow[]) {
  if (!rows.length) {
    showToast('لا توجد خدمات محددة للتصدير.')
    return
  }
  const element = modal(`
    <button class="modal-close" aria-label="إغلاق">${svg('close')}</button>
    <p class="eyebrow">معاينة صورة القائمة</p>
    <h2>تأكيد بيانات التصدير</h2>
    <div class="export-preview-fields">
      <label>اسم الزبون
        <input id="export-customer-name" type="text" maxlength="80" placeholder="أدخل اسم الزبون إن رغبت لطباعته مع القائمة">
      </label>
      <label>رقم هاتف الزبون
        <input id="export-customer-phone" type="tel" maxlength="40" placeholder="أدخل رقم هاتف الزبون إن رغبت لطباعته مع القائمة">
      </label>
      <label>عنوان الزبون
        <input id="export-customer-address" type="text" maxlength="100" placeholder="أدخل عنوان الزبون إن رغبت لطباعته مع القائمة">
      </label>
    </div>
    <div class="export-preview-wrap">
      <img id="export-preview-image" alt="معاينة قائمة أسعار الخدمات">
    </div>
    <button class="primary-button" id="confirm-export-image" type="button">تأكيد التصدير</button>
  `)
  element.querySelector('.modal-close')!.addEventListener('click', () => element.remove())
  const nameInput = element.querySelector<HTMLInputElement>('#export-customer-name')!
  const phoneInput = element.querySelector<HTMLInputElement>('#export-customer-phone')!
  const addressInput = element.querySelector<HTMLInputElement>('#export-customer-address')!
  const preview = element.querySelector<HTMLImageElement>('#export-preview-image')!
  const confirmButton = element.querySelector<HTMLButtonElement>('#confirm-export-image')!

  const refreshPreview = async () => {
    preview.classList.add('is-loading')
    const urls = await exportServicesToImage(confirmButton, 1, rows, {
      customerName: nameInput.value,
      customerPhone: phoneInput.value,
      customerAddress: addressInput.value,
      previewOnly: true,
    })
    if (urls?.[0]) preview.src = urls[0]
    preview.classList.remove('is-loading')
  }

  nameInput.addEventListener('input', () => void refreshPreview())
  phoneInput.addEventListener('input', () => void refreshPreview())
  addressInput.addEventListener('input', () => void refreshPreview())
  confirmButton.addEventListener('click', async () => {
    await exportServicesToImage(confirmButton, imageScale, rows, {
      customerName: nameInput.value,
      customerPhone: phoneInput.value,
      customerAddress: addressInput.value,
    })
    element.remove()
  })
  void refreshPreview()
}

const invoiceFinalPageCapacity = 20
const invoiceContinuationPageCapacity = 26

function invoicePageRowCounts(totalRows: number) {
  const pageCount = totalRows <= invoiceFinalPageCapacity
    ? 1
    : Math.ceil((totalRows - invoiceFinalPageCapacity) / invoiceContinuationPageCapacity) + 1
  const pageRowCounts: number[] = []
  let remainingRows = totalRows
  for (let pageIndex = 0; pageIndex < pageCount - 1; pageIndex += 1) {
    const pageRows = Math.min(invoiceContinuationPageCapacity, remainingRows - invoiceFinalPageCapacity)
    pageRowCounts.push(pageRows)
    remainingRows -= pageRows
  }
  pageRowCounts.push(remainingRows)
  return pageRowCounts
}

async function renderInvoiceCanvases(data: InvoiceExportData, imageScale: 1 | 2) {
  await document.fonts.ready
  await Promise.all([
    document.fonts.load('600 14px Cairo'),
    document.fonts.load('700 14px Cairo'),
    document.fonts.load('800 14px Cairo'),
  ])
  const width = 840
  const height = 1188
  const headerHeight = 42
  const rowHeight = 32
  const tableLeft = 40
  const tableRight = 800
  const tableTop = 210
  const pageRowCounts = invoicePageRowCounts(data.rows.length)
  const pageCount = pageRowCounts.length
  const hasNotes = data.rows.some((row) => row.notes.trim())
  const columns = [
    { title: 'م', width: 42, key: 'number' },
    { title: 'اسم الخدمة', width: hasNotes ? 237 : 342, key: 'name' },
    { title: 'الوحدة', width: 78, key: 'unit' },
    { title: 'الكمية', width: 70, key: 'quantity' },
    { title: 'سعر الوحدة ($)', width: 96, key: 'unitPrice' },
    { title: 'الإجمالي ($)', width: hasNotes ? 107 : 132, key: 'total' },
    ...(hasNotes ? [{ title: 'الملاحظات', width: 130, key: 'notes' }] : []),
  ]
  const canvases: HTMLCanvasElement[] = []
  let rowOffset = 0

  for (let pageIndex = 0; pageIndex < pageCount; pageIndex += 1) {
    const isFinalPage = pageIndex === pageCount - 1
    const pageSize = isFinalPage ? invoiceFinalPageCapacity : invoiceContinuationPageCapacity
    const pageRows = data.rows.slice(rowOffset, rowOffset + pageRowCounts[pageIndex])
    const pageRowOffset = rowOffset
    rowOffset += pageRows.length
    const canvas = document.createElement('canvas')
    canvas.width = width * imageScale
    canvas.height = height * imageScale
    const context = canvas.getContext('2d')
    if (!context) throw new Error('Canvas unavailable')
    context.scale(imageScale, imageScale)
    context.direction = 'rtl'
    context.fillStyle = '#fbfcfc'
    context.fillRect(0, 0, width, height)
    context.strokeStyle = '#c6a253'
    context.lineWidth = 2
    context.strokeRect(20, 20, width - 40, height - 40)

    context.textAlign = 'center'
    context.fillStyle = '#203044'
    context.font = '800 26px "Cairo", sans-serif'
    context.fillText('الكردي لأعمال البلاط والسيراميك والرخام', width / 2, 68)
    context.fillStyle = '#007d79'
    context.font = '700 19px "Cairo", sans-serif'
    context.fillText('فاتورة حساب للأعمال المنفذة', width / 2, 108)
    const customerSegments = customerDetailsSegments(data)
    const teacherSegments = responsibleTeacherSegments(data.responsibleTeacherName)
    drawDetailSegments(context, width, 138, customerSegments)
    const teacherY = customerSegments.length ? 156 : 138
    drawDetailSegments(context, width, teacherY, teacherSegments)
    context.textAlign = 'left'
    context.fillStyle = '#a64b37'
    context.font = '700 13px "Cairo", sans-serif'
    context.fillText(`رقم الفاتورة: ${data.invoiceNumber}`, tableLeft, 55)
    context.textAlign = 'center'
    context.fillStyle = '#667782'
    context.font = '600 13px "Cairo", sans-serif'
    const dateY = teacherSegments.length ? Math.max(164, teacherY + 18) : 164
    context.fillText(`تاريخ الإصدار: ${data.exportDate}`, width / 2, dateY)
    context.textAlign = 'center'
    context.fillStyle = '#a64b37'
    context.font = '600 13px "Cairo", sans-serif'
    const noticeLines = wrapCanvasText(
      context,
      'تنويه: هذه فاتورة حساب عن أعمال تم تنفيذها، وتوضح قيمة الخدمات المنفذة وفق البيانات أعلاه.',
      tableRight - tableLeft,
    )
    const displayedNoticeLines = noticeLines.slice(0, 2)
    const noticeStartY = 1110 - (displayedNoticeLines.length - 1) * 16
    displayedNoticeLines.forEach((line, index) =>
      context.fillText(line, width / 2, noticeStartY + index * 16, tableRight - tableLeft))

    const headerY = tableTop
    columns.reduce((right, column) => {
      const left = right - column.width
      context.fillStyle = '#007d79'
      context.fillRect(left, headerY, column.width, headerHeight)
      context.strokeStyle = '#d6e0e1'
      context.lineWidth = 1
      context.strokeRect(left, headerY, column.width, headerHeight)
      context.fillStyle = '#ffffff'
      context.font = '700 12px "Cairo", sans-serif'
      context.textAlign = 'center'
      context.fillText(column.title, left + column.width / 2, headerY + 27, column.width - 8)
      return left
    }, tableRight)

    for (let rowIndex = 0; rowIndex < pageSize; rowIndex += 1) {
      const row = pageRows[rowIndex]
      const y = tableTop + headerHeight + rowIndex * rowHeight
      context.fillStyle = rowIndex % 2 === 0 ? '#f3f9f8' : '#f6f8fb'
      context.fillRect(tableLeft, y, tableRight - tableLeft, rowHeight)
      context.strokeStyle = '#d6e0e1'
      context.lineWidth = 1
      context.strokeRect(tableLeft, y, tableRight - tableLeft, rowHeight)
      let right = tableRight
      columns.forEach((column) => {
        const left = right - column.width
        context.strokeRect(left, y, column.width, rowHeight)
        const isCancelled = row?.cancelled === true
        const value = column.key === 'number'
          ? row ? String(pageRowOffset + rowIndex + 1) : ''
          : !row
            ? ''
            : column.key === 'name'
              ? row.name
              : column.key === 'notes'
                ? row.notes.trim() || '—'
                : column.key === 'unit'
                  ? row.unit
                  : column.key === 'quantity'
                    ? invoiceQuantity(row.quantity)
                    : column.key === 'unitPrice'
                      ? money(row.unitPrice)
                      : (isCancelled ? 'ملغاة' : `${money(row.total)} دولار`)
        context.fillStyle = isCancelled ? '#8a97a3' : '#203044'
        const isTextColumn = column.key === 'name' || column.key === 'notes'
        context.textAlign = isTextColumn ? 'right' : 'center'
        const maxWidth = column.width - (isTextColumn ? 14 : 8)
        let fontSize = 12
        let lines: string[]
        do {
          context.font = `700 ${fontSize}px "Cairo", sans-serif`
          lines = wrapCanvasText(context, value, maxWidth)
          if (lines.length <= 2 || fontSize === 9) break
          fontSize -= 1
        } while (true)
        if (lines.length > 2) {
          lines = lines.slice(0, 2)
          let lastLine = lines[1] ?? ''
          while (lastLine && context.measureText(`${lastLine}…`).width > maxWidth) {
            lastLine = lastLine.slice(0, -1)
          }
          lines[1] = `${lastLine}…`
        }
        context.font = `700 ${fontSize}px "Cairo", sans-serif`
        const textX = isTextColumn ? right - 7 : left + column.width / 2
        const lineHeight = fontSize + 1
        const firstBaseline = y + (rowHeight - lines.length * lineHeight) / 2 + fontSize * .85
        lines.forEach((line, lineIndex) =>
          context.fillText(line, textX, firstBaseline + lineIndex * lineHeight, maxWidth))
        right = left
      })
      if (row?.cancelled) {
        context.strokeStyle = '#9aa7b2'
        context.lineWidth = 1.5
        context.beginPath()
        context.moveTo(tableLeft + 6, y + rowHeight / 2)
        context.lineTo(tableRight - 6, y + rowHeight / 2)
        context.stroke()
      }
    }

    if (pageIndex === pageCount - 1) {
      const tableBottomY = tableTop + headerHeight + pageSize * rowHeight
      const exportPayments = (data.payments && data.payments.length
        ? data.payments
        : (data.upfrontPayment !== null && data.upfrontPayment > 0
          ? [{ amount: data.upfrontPayment, date: data.upfrontPaymentDate || '', note: '', createdAt: '' }]
          : [])).filter((payment) => payment.amount > 0)
      const hasPaymentsSection = exportPayments.length > 0
      const quantitySectionY = tableBottomY + (hasPaymentsSection ? 4 : 12)
      const quantityTitleHeight = hasPaymentsSection ? 20 : 24
      const quantityCellHeight = 24
      context.fillStyle = '#007d79'
      context.fillRect(tableLeft, quantitySectionY, tableRight - tableLeft, quantityTitleHeight)
      context.strokeStyle = '#c6a253'
      context.lineWidth = 1
      context.strokeRect(tableLeft, quantitySectionY, tableRight - tableLeft, quantityTitleHeight)
      context.textAlign = 'center'
      context.fillStyle = '#ffffff'
      context.font = '700 12px "Cairo", sans-serif'
      context.fillText(
        'إجمالي كميات الأعمال المنفذة للورشة:',
        width / 2,
        quantitySectionY + 17,
        tableRight - tableLeft - 12,
      )
      const quantityCellY = quantitySectionY + quantityTitleHeight
      context.fillStyle = '#f3f9f8'
      context.fillRect(tableLeft, quantityCellY, tableRight - tableLeft, quantityCellHeight)
      context.strokeStyle = '#c6a253'
      context.strokeRect(tableLeft, quantityCellY, tableRight - tableLeft, quantityCellHeight)
      const quantitySummary = data.unitTotals.map(({ unit, quantity, amount }) =>
        `${invoiceQuantity(quantity)} ${unit} = ${amount === null ? '—' : `${money(amount)} دولار`}`).join('  |  ')
      let quantityFontSize = 11
      context.fillStyle = '#203044'
      context.textAlign = 'center'
      do {
        context.font = `700 ${quantityFontSize}px "Cairo", sans-serif`
        if (context.measureText(quantitySummary).width <= tableRight - tableLeft - 16 || quantityFontSize === 7) break
        quantityFontSize -= 1
      } while (true)
      context.fillText(quantitySummary, width / 2, quantityCellY + quantityCellHeight / 2 + quantityFontSize / 3, tableRight - tableLeft - 16)

      const financialTitleY = quantityCellY + quantityCellHeight + (hasPaymentsSection ? 4 : 8)
      const financialTitleHeight = hasPaymentsSection ? 18 : 22
      context.fillStyle = '#e8f5f2'
      context.fillRect(tableLeft, financialTitleY, tableRight - tableLeft, financialTitleHeight)
      context.strokeStyle = '#c6a253'
      context.strokeRect(tableLeft, financialTitleY, tableRight - tableLeft, financialTitleHeight)
      context.textAlign = 'center'
      context.fillStyle = '#006e69'
      context.font = '700 12px "Cairo", sans-serif'
      context.fillText('حساب إجمالي الفاتورة', width / 2, financialTitleY + 15)
      const moneySummaryY = financialTitleY + financialTitleHeight + (hasPaymentsSection ? 2 : 4)
      const discount = data.discount
      const hasDiscount = Boolean(discount?.amount)
      const finalTotal = data.total - (discount?.amount || 0)
      const summaryCards: Array<{ label: string; value: string; fill: string; color: string }> = hasDiscount && discount
        ? [
          { label: 'الإجمالي قبل الخصم', value: `${money(data.total)} دولار`, fill: '#e8f5f2', color: '#006e69' },
          { label: discount.mode === 'percentage' ? `الخصم (${discount.value}%)` : 'قيمة الخصم', value: `${money(discount.amount)} دولار`, fill: '#fff0ed', color: '#c62828' },
          { label: 'الإجمالي بعد الخصم', value: `${money(finalTotal)} دولار`, fill: '#e8f5f2', color: '#006e69' },
        ]
        : []
      if (!hasDiscount) {
        summaryCards.push({
          label: 'الإجمالي النهائي',
          value: `${money(finalTotal)} دولار`,
          fill: '#e8f5f2',
          color: '#006e69',
        })
      }
      const cardGap = 8
      const summaryWidth = tableRight - tableLeft
      const cardWidth = (summaryWidth - cardGap * (summaryCards.length - 1)) / summaryCards.length
      let right = tableRight
      const cardHeight = hasPaymentsSection ? 48 : 58
      summaryCards.forEach((card) => {
        const left = right - cardWidth
        context.fillStyle = card.fill
        context.fillRect(left, moneySummaryY, cardWidth, cardHeight)
        context.strokeStyle = card.color === '#c62828' ? card.color : '#c6a253'
        context.lineWidth = 1
        context.strokeRect(left, moneySummaryY, cardWidth, cardHeight)
        context.textAlign = 'center'
        context.fillStyle = card.color
        context.font = '700 12px "Cairo", sans-serif'
        context.fillText(card.label, left + cardWidth / 2, moneySummaryY + (hasPaymentsSection ? 16 : 22), cardWidth - 10)
        context.font = '800 15px "Cairo", sans-serif'
        const valueBaseline = moneySummaryY + (hasPaymentsSection ? 36 : 45)
        if (!hasDiscount || card.label === 'الإجمالي بعد الخصم') {
          const valueBoxWidth = Math.min(cardWidth - 16, context.measureText(card.value).width + 20)
          const valueBoxHeight = hasPaymentsSection ? 20 : 24
          const valueBoxY = valueBaseline - (hasPaymentsSection ? 15 : 17)
          context.strokeStyle = '#c62828'
          context.lineWidth = 2
          context.strokeRect(left + cardWidth / 2 - valueBoxWidth / 2, valueBoxY, valueBoxWidth, valueBoxHeight)
        }
        context.fillText(card.value, left + cardWidth / 2, valueBaseline, cardWidth - 10)
        right = left - cardGap
      })
      if (hasPaymentsSection) {
        const paymentsTitleY = moneySummaryY + cardHeight + 4
        const paymentsTitleHeight = 18
        context.fillStyle = '#007d79'
        context.fillRect(tableLeft, paymentsTitleY, tableRight - tableLeft, paymentsTitleHeight)
        context.strokeStyle = '#c6a253'
        context.strokeRect(tableLeft, paymentsTitleY, tableRight - tableLeft, paymentsTitleHeight)
        context.textAlign = 'center'
        context.fillStyle = '#ffffff'
        context.font = '700 11px "Cairo", sans-serif'
        context.fillText('الدفعات والمتبقي', width / 2, paymentsTitleY + 13)

        const paidTotal = exportPayments.reduce((sum, payment) => sum + (Number.isFinite(payment.amount) ? payment.amount : 0), 0)
        const remainingAmount = Number(Math.max(0, finalTotal - paidTotal).toFixed(2))
        const paymentsAreaY = paymentsTitleY + paymentsTitleHeight + 4
        const totalWidth = tableRight - tableLeft
        if (exportPayments.length === 1) {
          const payment = exportPayments[0]
          const paymentCellHeight = 44
          const paymentCellWidth = totalWidth / 2
          const paymentCells = [
            {
              left: tableLeft + paymentCellWidth,
              label: 'الدفعة',
              value: `${money(payment.amount)} دولار`,
              sublabel: payment.date ? `تاريخ الدفعة: ${payment.date}` : '',
              fill: '#f3f9f8',
            },
            {
              left: tableLeft,
              label: 'المتبقي من المبلغ',
              value: `${money(remainingAmount)} دولار`,
              sublabel: '',
              fill: '#e8f5f2',
            },
          ]
          paymentCells.forEach((cell) => {
            context.fillStyle = cell.fill
            context.fillRect(cell.left, paymentsAreaY, paymentCellWidth, paymentCellHeight)
            context.strokeStyle = '#c6a253'
            context.strokeRect(cell.left, paymentsAreaY, paymentCellWidth, paymentCellHeight)
            context.textAlign = 'center'
            context.fillStyle = '#006e69'
            context.font = '700 10px "Cairo", sans-serif'
            context.fillText(cell.label, cell.left + paymentCellWidth / 2, paymentsAreaY + 12, paymentCellWidth - 10)
            context.font = '800 14px "Cairo", sans-serif'
            context.fillText(cell.value, cell.left + paymentCellWidth / 2, paymentsAreaY + 28, paymentCellWidth - 10)
            if (cell.sublabel) {
              context.fillStyle = '#667782'
              context.font = '600 8px "Cairo", sans-serif'
              context.fillText(cell.sublabel, cell.left + paymentCellWidth / 2, paymentsAreaY + 40, paymentCellWidth - 10)
            }
          })
        } else {
          const paymentCards = [
            ...exportPayments.map((payment, index) => ({
              label: exportPayments.length > 1 ? `الدفعة ${index + 1}` : 'الدفعة',
              value: `${money(payment.amount)} دولار`,
              sublabel: [payment.date ? `التاريخ: ${payment.date}` : '', payment.note || ''].filter(Boolean).join(' — '),
              fill: '#f3f9f8',
              valueColor: '#203044',
              labelColor: '#006e69',
            })),
            {
              label: 'المتبقي من المبلغ',
              value: `${money(remainingAmount)} دولار`,
              sublabel: '',
              fill: '#e8f5f2',
              valueColor: '#203044',
              labelColor: '#006e69',
            },
          ]
          const cardGap = 8
          const paymentCardWidth = (totalWidth - cardGap * (paymentCards.length - 1)) / paymentCards.length
          const paymentCardHeight = 44
          let cardRight = tableRight
          paymentCards.forEach((card) => {
            const left = cardRight - paymentCardWidth
            context.fillStyle = card.fill
            context.fillRect(left, paymentsAreaY, paymentCardWidth, paymentCardHeight)
            context.strokeStyle = '#c6a253'
            context.lineWidth = 1
            context.strokeRect(left, paymentsAreaY, paymentCardWidth, paymentCardHeight)
            context.textAlign = 'center'
            context.fillStyle = card.labelColor
            context.font = '700 10px "Cairo", sans-serif'
            context.fillText(card.label, left + paymentCardWidth / 2, paymentsAreaY + 12, paymentCardWidth - 10)
            context.fillStyle = card.valueColor
            context.font = '800 14px "Cairo", sans-serif'
            context.fillText(card.value, left + paymentCardWidth / 2, paymentsAreaY + 28, paymentCardWidth - 10)
            if (card.sublabel) {
              context.fillStyle = '#667782'
              context.font = '600 8px "Cairo", sans-serif'
              context.fillText(card.sublabel, left + paymentCardWidth / 2, paymentsAreaY + 40, paymentCardWidth - 10)
            }
            cardRight = left - cardGap
          })
        }
      }
    }

    const exportNote = (data.exportNote || '').trim()
    const isLastPage = pageIndex === pageCount - 1
    if (exportNote && isLastPage) {
      context.textAlign = 'center'
      context.fillStyle = '#203044'
      context.font = '700 11px "Cairo", sans-serif'
      const noteText = `ملاحظة: ${exportNote}`
      const noteLines = wrapCanvasText(context, noteText, width - 120).slice(0, 2)
      let noteY = 1118
      noteLines.forEach((line) => {
        context.fillText(line, width / 2, noteY)
        noteY += 16
      })
    }

    context.textAlign = 'center'
    context.fillStyle = '#667782'
    context.font = '600 11px "Cairo", sans-serif'
    context.fillText(
      `الكردي لأعمال البلاط والسيراميك والرخام  •  صفحة ${pageIndex + 1} من ${pageCount}`,
      width / 2,
      exportNote && isLastPage ? 1158 : 1144,
    )
    canvases.push(canvas)
  }
  return canvases
}

async function exportInvoiceImage(
  button: HTMLButtonElement,
  data: InvoiceExportData,
  imageScale: 1 | 2,
) {
  button.disabled = true
  try {
    const canvases = await renderInvoiceCanvases(data, imageScale)
    for (let pageIndex = 0; pageIndex < canvases.length; pageIndex += 1) {
      const blob = await new Promise<Blob>((resolve, reject) => {
        canvases[pageIndex].toBlob((value) => {
          if (value) resolve(value)
          else reject(new Error('Could not create invoice image'))
        }, 'image/png')
      })
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = `فاتورة-${data.invoiceNumber}-${data.exportDate}-صفحة-${pageIndex + 1}.png`
      document.body.append(link)
      link.click()
      link.remove()
      window.setTimeout(() => URL.revokeObjectURL(url), 1000)
    }
    showToast(imageScale === 2 ? 'تم تصدير الفاتورة كصورة فائقة.' : 'تم تصدير الفاتورة كصورة.')
    return true
  } catch (error) {
    console.error('Failed to export invoice image:', error)
    showToast('تعذر تصدير صورة الفاتورة. حاول مجددًا.')
    return false
  } finally {
    button.disabled = false
  }
}

async function exportInvoiceToExcel(button: HTMLButtonElement, data: InvoiceExportData) {
  button.disabled = true
  try {
    const ExcelJS = await import('exceljs')
    const workbook = new ExcelJS.Workbook()
    const worksheet = workbook.addWorksheet('فاتورة الحساب', {
      views: [{ rightToLeft: true }],
      pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
    })
    const hasNotes = data.rows.some((row) => row.notes.trim())
    const tableColumns = [
      { key: 'number', width: 7 },
      { key: 'name', width: 38 },
      { key: 'unit', width: 16 },
      { key: 'quantity', width: 13 },
      { key: 'unitPrice', width: 20 },
      { key: 'total', width: 10 },
      ...(hasNotes ? [{ key: 'notes', width: 34 }] : []),
    ]
    worksheet.columns = tableColumns
    const tableColumnCount = tableColumns.length
    const invoiceColumnCount = Math.max(tableColumnCount, data.unitTotals.length)
    for (let columnNumber = tableColumnCount + 1; columnNumber <= invoiceColumnCount; columnNumber += 1) {
      worksheet.getColumn(columnNumber).width = 12
    }
    const lastColumn = worksheet.getColumn(invoiceColumnCount).letter
    worksheet.mergeCells(`A1:${lastColumn}1`)
    worksheet.mergeCells(`A2:${lastColumn}2`)
    worksheet.getCell('A1').value = 'الكردي لأعمال البلاط والسيراميك والرخام'
    worksheet.getCell('A2').value = 'فاتورة حساب للأعمال المنفذة'
    worksheet.getRow(1).height = 32
    worksheet.getRow(2).height = 26
    worksheet.mergeCells(`A3:${lastColumn}3`)
    worksheet.getCell('A3').value = `فاتورة رقم ${data.invoiceNumber}`
    worksheet.getRow(3).height = 24
    worksheet.getCell('A3').font = { name: 'Arial', size: 12, bold: true, color: { argb: 'FFA64B37' } }
    worksheet.getCell('A3').alignment = { horizontal: 'left', vertical: 'middle' }
    let metadataRowNumber = 4
    const customerSegments = customerDetailsSegments(data)
    if (customerSegments.length) {
      worksheet.mergeCells(`A${metadataRowNumber}:${lastColumn}${metadataRowNumber}`)
      const cell = worksheet.getCell(`A${metadataRowNumber}`)
      cell.value = {
        richText: customerSegments.map(({ text, red }) => ({
          text,
          font: { name: 'Arial', color: { argb: red ? 'FFC96A6A' : 'FF718096' } },
        })),
      }
      cell.alignment = { horizontal: 'right', vertical: 'middle' }
      worksheet.getRow(metadataRowNumber).height = 24
      metadataRowNumber += 1
    }
    const teacherSegments = responsibleTeacherSegments(data.responsibleTeacherName)
    if (teacherSegments.length) {
      worksheet.mergeCells(`A${metadataRowNumber}:${lastColumn}${metadataRowNumber}`)
      const cell = worksheet.getCell(`A${metadataRowNumber}`)
      cell.value = {
        richText: teacherSegments.map(({ text, red }) => ({
          text,
          font: { name: 'Arial', color: { argb: red ? 'FFC96A6A' : 'FF718096' } },
        })),
      }
      cell.alignment = { horizontal: 'right', vertical: 'middle' }
      worksheet.getRow(metadataRowNumber).height = 24
      metadataRowNumber += 1
    }
    worksheet.mergeCells(`A${metadataRowNumber}:${lastColumn}${metadataRowNumber}`)
    worksheet.getCell(`A${metadataRowNumber}`).value = `تاريخ الإصدار: ${data.exportDate}`
    worksheet.getRow(metadataRowNumber).height = 23
    const headerRowNumber = metadataRowNumber + 1
    worksheet.pageSetup.printTitlesRow = `${headerRowNumber}:${headerRowNumber}`
    const headerRow = worksheet.getRow(headerRowNumber)
    headerRow.values = [
      'م',
      'اسم الخدمة',
      'الوحدة',
      'الكمية',
      'سعر الوحدة (دولار)',
      'الإجمالي (دولار)',
      ...(hasNotes ? ['الملاحظات'] : []),
    ]
    headerRow.height = 28
    const pageRowCounts = invoicePageRowCounts(data.rows.length)
    const serviceSlotCount = pageRowCounts.reduce(
      (total, _pageRows, pageIndex) =>
        total + (pageIndex === pageRowCounts.length - 1 ? invoiceFinalPageCapacity : invoiceContinuationPageCapacity),
      0,
    )
    let serviceRowIndex = 0
    let pageSlotOffset = 0
    const slotRows: Array<InvoiceExportRow | undefined> = []
    pageRowCounts.forEach((pageRows, pageIndex) => {
      const pageCapacity = pageIndex === pageRowCounts.length - 1
        ? invoiceFinalPageCapacity
        : invoiceContinuationPageCapacity
      for (let rowIndex = 0; rowIndex < pageCapacity; rowIndex += 1) {
        const row = rowIndex < pageRows ? data.rows[serviceRowIndex] : undefined
        const number = row ? serviceRowIndex + 1 : ''
        if (row) serviceRowIndex += 1
        slotRows.push(row)
        worksheet.addRow(row
          ? [
            number,
            row.name,
            row.unit,
            row.quantity,
            row.unitPrice,
            row.cancelled ? 'ملغاة' : row.total,
            ...(hasNotes ? [row.notes] : []),
          ]
          : [number, ...Array.from({ length: tableColumnCount - 1 }, () => '')])
      }
      pageSlotOffset += pageCapacity
      if (pageIndex < pageRowCounts.length - 1) {
        worksheet.getRow(headerRowNumber + pageSlotOffset).addPageBreak()
      }
    })
    const dataEndRow = headerRowNumber + serviceSlotCount
    worksheet.autoFilter = { from: `A${headerRowNumber}`, to: `${worksheet.getColumn(tableColumnCount).letter}${dataEndRow}` }
    worksheet.views = [{ state: 'frozen', ySplit: headerRowNumber, rightToLeft: true }]
    for (let rowNumber = headerRowNumber; rowNumber <= dataEndRow; rowNumber += 1) {
      const row = worksheet.getRow(rowNumber)
      const slotRow = rowNumber > headerRowNumber ? slotRows[rowNumber - headerRowNumber - 1] : undefined
      const isCancelled = slotRow?.cancelled === true
      row.height = rowNumber === headerRowNumber ? 28 : 16
      row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
        cell.alignment = rowNumber === headerRowNumber
          ? { horizontal: 'center', vertical: 'middle', wrapText: true }
          : { horizontal: 'center', vertical: 'middle', shrinkToFit: true }
        const textColor = rowNumber === headerRowNumber ? 'FFFFFFFF' : (isCancelled ? 'FF8A97A3' : 'FF203044')
        cell.font = {
          name: 'Arial',
          size: rowNumber === headerRowNumber ? 11 : 10,
          bold: true,
          color: { argb: textColor },
          strike: isCancelled && rowNumber !== headerRowNumber && colNumber !== 1 && colNumber !== 6,
        }
        if (isCancelled && rowNumber !== headerRowNumber && colNumber === 6) {
          cell.numFmt = '@'
        }
        cell.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: rowNumber === headerRowNumber ? 'FF007D79' : rowNumber % 2 === 0 ? 'FFF3F9F8' : 'FFFFFFFF' },
        }
        cell.border = {
          top: { style: 'thin', color: { argb: 'FFC6A253' } },
          bottom: { style: 'thin', color: { argb: 'FFC6A253' } },
          left: { style: 'thin', color: { argb: 'FFC6A253' } },
          right: { style: 'thin', color: { argb: 'FFC6A253' } },
        }
      })
    }
    worksheet.getColumn('quantity').numFmt = '0.######'
    worksheet.getColumn('unitPrice').numFmt = '0.00'
    worksheet.getColumn('total').numFmt = '0.00 "دولار"'
    worksheet.getCell('A1').font = { name: 'Arial', size: 18, bold: true, color: { argb: 'FF203044' } }
    worksheet.getCell('A1').alignment = { horizontal: 'center', vertical: 'middle' }
    worksheet.getCell('A2').font = { name: 'Arial', size: 14, bold: true, color: { argb: 'FF007D79' } }
    worksheet.getCell('A2').alignment = { horizontal: 'center', vertical: 'middle' }
    worksheet.getCell('A3').font = { name: 'Arial', size: 11, color: { argb: 'FF667782' } }
    worksheet.getCell('A3').alignment = { horizontal: 'center', vertical: 'middle' }

    const finalTotal = data.total - (data.discount?.amount || 0)
    const hasDiscount = Boolean(data.discount?.amount)
    let summaryRowNumber = dataEndRow + 2
    const summaryLabelLastColumn = worksheet.getColumn(invoiceColumnCount - 1).letter
    const addSummaryRow = (
      label: string,
      value: number,
      color: string,
      sublabel?: string,
      highlightValue = false,
    ) => {
      worksheet.mergeCells(`A${summaryRowNumber}:${summaryLabelLastColumn}${summaryRowNumber}`)
      const row = worksheet.getRow(summaryRowNumber)
      row.getCell(1).value = label
      row.getCell(invoiceColumnCount).value = sublabel
        ? {
          richText: [
            { text: `${money(value)} دولار\n`, font: { name: 'Arial', size: 14, bold: true, color: { argb: 'FF006E69' } } },
            { text: sublabel, font: { name: 'Arial', size: 9, color: { argb: 'FF667782' } } },
          ],
        }
        : value
      row.height = sublabel ? 38 : 25
      row.eachCell({ includeEmpty: true }, (cell, columnNumber) => {
        const isHighlightedValue = highlightValue && columnNumber === invoiceColumnCount
        cell.font = { name: 'Arial', size: 11, bold: true, color: { argb: color } }
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: color === 'FFC62828' ? 'FFFFEFED' : 'FFE8F5F2' } }
        cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: Boolean(sublabel) }
        cell.border = {
          top: { style: isHighlightedValue ? 'medium' : 'thin', color: { argb: isHighlightedValue ? 'FFC62828' : 'FFC6A253' } },
          bottom: { style: isHighlightedValue ? 'medium' : 'thin', color: { argb: isHighlightedValue ? 'FFC62828' : 'FFC6A253' } },
          left: { style: isHighlightedValue ? 'medium' : 'thin', color: { argb: isHighlightedValue ? 'FFC62828' : 'FFC6A253' } },
          right: { style: isHighlightedValue ? 'medium' : 'thin', color: { argb: isHighlightedValue ? 'FFC62828' : 'FFC6A253' } },
        }
      })
      if (!sublabel) row.getCell(invoiceColumnCount).numFmt = '0.00 "دولار"'
      summaryRowNumber += 1
    }
    const addCenteredFinalTotalRow = () => {
      const centerStartColumn = Math.floor((invoiceColumnCount - 2) / 2) + 1
      const centerEndColumn = centerStartColumn + 1
      const row = worksheet.getRow(summaryRowNumber)
      if (centerStartColumn > 1) {
        worksheet.mergeCells(`A${summaryRowNumber}:${worksheet.getColumn(centerStartColumn - 1).letter}${summaryRowNumber}`)
      }
      worksheet.mergeCells(
        `${worksheet.getColumn(centerStartColumn).letter}${summaryRowNumber}:${worksheet.getColumn(centerEndColumn).letter}${summaryRowNumber}`,
      )
      if (centerEndColumn < invoiceColumnCount) {
        worksheet.mergeCells(
          `${worksheet.getColumn(centerEndColumn + 1).letter}${summaryRowNumber}:${lastColumn}${summaryRowNumber}`,
        )
      }
      row.getCell(1).value = 'الإجمالي النهائي'
      row.getCell(centerStartColumn).value = finalTotal
      row.height = 32
      for (let columnNumber = 1; columnNumber <= invoiceColumnCount; columnNumber += 1) {
        const cell = row.getCell(columnNumber)
        const isAmountCell = columnNumber >= centerStartColumn && columnNumber <= centerEndColumn
        cell.font = {
          name: 'Arial',
          size: isAmountCell ? 14 : 11,
          bold: true,
          color: { argb: 'FF006E69' },
        }
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8F5F2' } }
        cell.alignment = { horizontal: 'center', vertical: 'middle' }
        cell.border = {
          top: { style: isAmountCell ? 'medium' : 'thin', color: { argb: isAmountCell ? 'FFC62828' : 'FFC6A253' } },
          bottom: { style: isAmountCell ? 'medium' : 'thin', color: { argb: isAmountCell ? 'FFC62828' : 'FFC6A253' } },
          left: { style: isAmountCell ? 'medium' : 'thin', color: { argb: isAmountCell ? 'FFC62828' : 'FFC6A253' } },
          right: { style: isAmountCell ? 'medium' : 'thin', color: { argb: isAmountCell ? 'FFC62828' : 'FFC6A253' } },
        }
      }
      row.getCell(centerStartColumn).numFmt = '0.00 "دولار"'
      summaryRowNumber += 1
    }
    worksheet.mergeCells(`A${summaryRowNumber}:${lastColumn}${summaryRowNumber}`)
    const quantityTitleRow = worksheet.getRow(summaryRowNumber)
    quantityTitleRow.getCell(1).value = 'إجمالي كميات الأعمال المنفذة للورشة:'
    quantityTitleRow.height = 25
    quantityTitleRow.eachCell({ includeEmpty: true }, (cell) => {
      cell.font = { name: 'Arial', size: 11, bold: true, color: { argb: 'FFFFFFFF' } }
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF007D79' } }
      cell.alignment = { horizontal: 'center', vertical: 'middle' }
      cell.border = {
        top: { style: 'thin', color: { argb: 'FFC6A253' } },
        bottom: { style: 'thin', color: { argb: 'FFC6A253' } },
        left: { style: 'thin', color: { argb: 'FFC6A253' } },
        right: { style: 'thin', color: { argb: 'FFC6A253' } },
      }
    })
    summaryRowNumber += 1
    if (data.unitTotals.length) {
      const quantitySummary = data.unitTotals.map(({ unit, quantity, amount }) =>
        `${invoiceQuantity(quantity)} ${unit} = ${amount === null ? '—' : `${money(amount)} دولار`}`).join('  |  ')
      worksheet.mergeCells(`A${summaryRowNumber}:${lastColumn}${summaryRowNumber}`)
      const quantityRow = worksheet.getRow(summaryRowNumber)
      quantityRow.getCell(1).value = quantitySummary
      quantityRow.height = 18
      quantityRow.eachCell({ includeEmpty: true }, (cell) => {
        cell.font = { name: 'Arial', size: 11, bold: true, color: { argb: 'FF006E69' } }
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8F5F2' } }
        cell.alignment = { horizontal: 'center', vertical: 'middle', shrinkToFit: true }
        cell.border = {
          top: { style: 'thin', color: { argb: 'FFC6A253' } },
          bottom: { style: 'thin', color: { argb: 'FFC6A253' } },
          left: { style: 'thin', color: { argb: 'FFC6A253' } },
          right: { style: 'thin', color: { argb: 'FFC6A253' } },
        }
      })
      summaryRowNumber += 1
    }
    if (hasDiscount && data.discount) {
      addSummaryRow('الإجمالي قبل الخصم', data.total, 'FF006E69')
      addSummaryRow(
        data.discount.mode === 'percentage' ? `الخصم (${data.discount.value}%)` : 'قيمة الخصم',
        -data.discount.amount,
        'FFC62828',
      )
    }
    if (hasDiscount) addSummaryRow('الإجمالي النهائي', finalTotal, 'FF006E69', undefined, true)
    else addCenteredFinalTotalRow()
    const exportPayments = (data.payments && data.payments.length
      ? data.payments
      : (data.upfrontPayment !== null && data.upfrontPayment > 0
        ? [{ amount: data.upfrontPayment, date: data.upfrontPaymentDate || '', note: '', createdAt: '' }]
        : [])).filter((payment) => payment.amount > 0)
    if (exportPayments.length) {
      worksheet.mergeCells(`A${summaryRowNumber}:${lastColumn}${summaryRowNumber}`)
      const paymentsTitleRow = worksheet.getRow(summaryRowNumber)
      paymentsTitleRow.getCell(1).value = 'الدفعات والمتبقي'
      paymentsTitleRow.height = 22
      paymentsTitleRow.eachCell({ includeEmpty: true }, (cell) => {
        cell.font = { name: 'Arial', size: 11, bold: true, color: { argb: 'FFFFFFFF' } }
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF007D79' } }
        cell.alignment = { horizontal: 'center', vertical: 'middle' }
        cell.border = {
          top: { style: 'thin', color: { argb: 'FFC6A253' } },
          bottom: { style: 'thin', color: { argb: 'FFC6A253' } },
          left: { style: 'thin', color: { argb: 'FFC6A253' } },
          right: { style: 'thin', color: { argb: 'FFC6A253' } },
        }
      })
      summaryRowNumber += 1
      const paidTotal = exportPayments.reduce((sum, payment) => sum + (Number.isFinite(payment.amount) ? payment.amount : 0), 0)
      const remainingAmount = Number(Math.max(0, finalTotal - paidTotal).toFixed(2))
      const paymentRowNumber = summaryRowNumber
      const paymentRow = worksheet.getRow(paymentRowNumber)
      paymentRow.height = 56
      const paymentCards = [
        ...exportPayments.map((payment, index) => ({
          label: exportPayments.length > 1 ? `الدفعة ${index + 1}` : 'الدفعة',
          value: `${money(payment.amount)} دولار`,
          sublabel: [payment.date ? `التاريخ: ${payment.date}` : '', payment.note || ''].filter(Boolean).join(' — '),
          fill: 'FFF3F9F8',
        })),
        {
          label: 'المتبقي من المبلغ',
          value: `${money(remainingAmount)} دولار`,
          sublabel: '',
          fill: 'FFE8F5F2',
        },
      ]
      const formatPaymentCard = (
        startColumn: number,
        endColumn: number,
        richText: import('exceljs').RichText[],
        fillColor: string,
      ) => {
        const startLetter = worksheet.getColumn(startColumn).letter
        const endLetter = worksheet.getColumn(endColumn).letter
        worksheet.mergeCells(`${startLetter}${paymentRowNumber}:${endLetter}${paymentRowNumber}`)
        const card = paymentRow.getCell(startColumn)
        card.value = { richText }
        card.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true }
        for (let columnNumber = startColumn; columnNumber <= endColumn; columnNumber += 1) {
          const cell = paymentRow.getCell(columnNumber)
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: fillColor } }
          cell.border = {
            top: { style: 'thin', color: { argb: 'FFC6A253' } },
            bottom: { style: 'thin', color: { argb: 'FFC6A253' } },
            left: { style: 'thin', color: { argb: 'FFC6A253' } },
            right: { style: 'thin', color: { argb: 'FFC6A253' } },
          }
        }
      }
      const cardCount = paymentCards.length
      for (let i = 0; i < cardCount; i += 1) {
        // distribute cards RTL across columns in order: first payment on right, remaining on left
        const startColumn = Math.floor((i * invoiceColumnCount) / cardCount) + 1
        const endColumn = Math.max(startColumn, Math.floor(((i + 1) * invoiceColumnCount) / cardCount))
        const card = paymentCards[cardCount - 1 - i]
        const richText: import('exceljs').RichText[] = [
          { text: `${card.label}\n`, font: { name: 'Arial', size: 10, bold: true, color: { argb: 'FF006E69' } } },
          { text: `${card.value}${card.sublabel ? '\n' : ''}`, font: { name: 'Arial', size: 14, bold: true, color: { argb: 'FF203044' } } },
        ]
        if (card.sublabel) {
          richText.push({ text: card.sublabel, font: { name: 'Arial', size: 9, color: { argb: 'FF667782' } } })
        }
        formatPaymentCard(startColumn, endColumn, richText, card.fill)
      }
      summaryRowNumber += 1
    }
    const exportNote = (data.exportNote || '').trim()
    let cursorRow = summaryRowNumber + 1
    if (exportNote) {
      const noteRowNumber = cursorRow
      worksheet.mergeCells(`A${noteRowNumber}:${lastColumn}${noteRowNumber}`)
      const noteRow = worksheet.getRow(noteRowNumber)
      noteRow.height = 24
      const noteCell = worksheet.getCell(`A${noteRowNumber}`)
      noteCell.value = `ملاحظة: ${exportNote}`
      noteCell.font = { name: 'Arial', size: 11, bold: true, color: { argb: 'FF203044' } }
      noteCell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true }
      noteRow.eachCell({ includeEmpty: true }, (cell) => {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF8E8' } }
        cell.border = {
          top: { style: 'thin', color: { argb: 'FFC6A253' } },
          bottom: { style: 'thin', color: { argb: 'FFC6A253' } },
          left: { style: 'thin', color: { argb: 'FFC6A253' } },
          right: { style: 'thin', color: { argb: 'FFC6A253' } },
        }
      })
      cursorRow += 1
    }
    const noticeRowNumber = cursorRow
    worksheet.mergeCells(`A${noticeRowNumber}:${lastColumn}${noticeRowNumber}`)
    worksheet.getCell(`A${noticeRowNumber}`).value =
      'تنويه: هذه فاتورة حساب عن أعمال تم تنفيذها، وتوضح قيمة الخدمات المنفذة وفق البيانات أعلاه.'
    worksheet.getCell(`A${noticeRowNumber}`).font = { name: 'Arial', size: 10, color: { argb: 'FFA64B37' } }
    worksheet.getCell(`A${noticeRowNumber}`).alignment = { horizontal: 'center', vertical: 'middle', wrapText: true }
    worksheet.getRow(noticeRowNumber).height = 30
    const companyFooterRowNumber = noticeRowNumber + 1
    worksheet.mergeCells(`A${companyFooterRowNumber}:${lastColumn}${companyFooterRowNumber}`)
    worksheet.getCell(`A${companyFooterRowNumber}`).value = 'الكردي لأعمال البلاط والسيراميك والرخام'
    worksheet.getCell(`A${companyFooterRowNumber}`).font = { name: 'Arial', size: 10, color: { argb: 'FF667782' } }
    worksheet.getCell(`A${companyFooterRowNumber}`).alignment = { horizontal: 'center', vertical: 'middle' }
    worksheet.getRow(companyFooterRowNumber).height = 24
    worksheet.pageSetup.printArea = `A1:${lastColumn}${companyFooterRowNumber}`

    const buffer = await workbook.xlsx.writeBuffer()
    const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `فاتورة-${data.invoiceNumber}-${data.exportDate}.xlsx`
    document.body.append(link)
    link.click()
    link.remove()
    window.setTimeout(() => URL.revokeObjectURL(url), 1000)
    showToast('تم تصدير الفاتورة كملف Excel.')
    return true
  } catch (error) {
    console.error('Failed to export invoice Excel:', error)
    showToast('تعذر تصدير ملف الفاتورة. حاول مجددًا.')
    return false
  } finally {
    button.disabled = false
  }
}

function formatInvoiceDateTime(date = new Date()): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  const hh = String(date.getHours()).padStart(2, '0')
  const mm = String(date.getMinutes()).padStart(2, '0')
  return `${y}-${m}-${d} ${hh}:${mm}`
}

function getInvoiceRootVersions(rootId: string): InvoiceRecord[] {
  return invoiceRecords
    .filter((record) => record.rootId === rootId)
    .sort((a, b) => a.version - b.version || a.savedAt.localeCompare(b.savedAt))
}

function getInvoiceNetTotal(record: InvoiceRecord): number {
  return Math.max(0, record.total - (record.discount?.amount || 0))
}

function getInvoicePaidTotal(record: InvoiceRecord): number {
  return record.payments.reduce((sum, payment) => sum + (Number.isFinite(payment.amount) ? payment.amount : 0), 0)
}

function getInvoiceRemainingTotal(record: InvoiceRecord): number {
  return Math.max(0, Number((getInvoiceNetTotal(record) - getInvoicePaidTotal(record)).toFixed(2)))
}

function getInvoicePaymentStatus(record: InvoiceRecord): { key: 'paid' | 'partial' | 'unpaid'; label: string } {
  const net = getInvoiceNetTotal(record)
  const paid = getInvoicePaidTotal(record)
  if (net <= 0.00001 || paid >= net - 0.00001) return { key: 'paid', label: 'مسددة بالكامل' }
  if (paid > 0.00001) return { key: 'partial', label: 'مسددة جزئيًا' }
  return { key: 'unpaid', label: 'غير مسددة' }
}

function getInvoiceRecordEditableItems(record: InvoiceRecord): StoredInvoiceEditableItem[] {
  if (record.items.length) return record.items.map((item) => ({ ...item, cancelled: item.cancelled === true }))
  return record.rows.map((row) => ({
    custom: true,
    name: row.name,
    notes: row.notes,
    quantity: String(row.quantity),
    price: String(row.unitPrice),
    unit: row.unit,
    unitCode: null as ServiceUnit | null,
    currencyCode: 'USD',
    cancelled: row.cancelled === true,
  }))
}

function invoiceRecordToExportData(record: InvoiceRecord): InvoiceExportData {
  const payments = record.payments.map((payment) => ({ ...payment }))
  const lastPayment = payments[payments.length - 1]
  return {
    rows: record.rows.map((row) => ({ ...row })),
    unitTotals: record.unitTotals.map((item) => ({ ...item })),
    invoiceNumber: record.rootInvoiceNumber || record.invoiceNumber,
    total: record.total,
    discount: record.discount ? { ...record.discount } : null,
    exportFormat: record.exportFormat || 'image-high',
    exportDate: record.exportDate || formatInvoiceDateTime(new Date()),
    customerId: record.customerId,
    customerName: record.customerName || '',
    customerPhone: record.customerPhone || '',
    customerAddress: record.customerAddress || '',
    responsibleTeacherName: record.responsibleTeacherName || '',
    upfrontPayment: lastPayment ? lastPayment.amount : null,
    upfrontPaymentDate: lastPayment?.date || '',
    payments,
    exportNote: '',
  }
}

function invoiceTermsSignature(record: InvoiceRecord): string {
  return JSON.stringify({
    rows: record.rows,
    unitTotals: record.unitTotals,
    items: record.items,
    total: record.total,
    discount: record.discount,
    customerId: record.customerId,
    customerName: record.customerName,
    customerPhone: record.customerPhone,
    customerAddress: record.customerAddress,
    responsibleTeacherName: record.responsibleTeacherName,
  })
}

type CorrectionChange = { label: string; before?: string; after?: string; text?: string }
type CorrectionEntry = { version: InvoiceRecord; when: string; summary: string; tags: string[]; changes: CorrectionChange[] }

function describeDiscount(discount: StoredInvoiceDiscount): string {
  if (!discount || !Number.isFinite(discount.amount) || discount.amount <= 0) return 'بدون خصم'
  return discount.mode === 'percentage'
    ? `${money(discount.amount)} دولار (${money(discount.value)}%)`
    : `${money(discount.amount)} دولار (مبلغ ثابت)`
}

function correctionItemName(item: { name?: string }, index: number): string {
  const name = (item.name || '').trim()
  return name ? `الخدمة "${name}"` : `خدمة #${index + 1}`
}

function describePayment(payment: InvoicePayment | undefined): string {
  if (!payment) return '—'
  const amount = Number.isFinite(payment.amount) ? `${money(payment.amount)} دولار` : '—'
  const date = (payment.date || '').trim() || 'بدون تاريخ'
  const note = (payment.note || '').trim()
  return `${amount} — ${date}${note ? ` (${note})` : ''}`
}

function paymentsSignature(record: InvoiceRecord): string {
  return JSON.stringify((record.payments || []).map((payment) => ({
    amount: Number.isFinite(payment.amount) ? Number(payment.amount.toFixed(2)) : 0,
    date: payment.date || '',
    note: payment.note || '',
  })))
}

function describeInvoiceCorrection(previous: InvoiceRecord, current: InvoiceRecord): CorrectionEntry {
  const changes: CorrectionChange[] = []
  const tags = new Set<string>()

  const push = (label: string, before: string, after: string, tag: string) => {
    if (before === after) return
    changes.push({ label, before, after })
    tags.add(tag)
  }

  push('اسم الزبون', (previous.customerName || '').trim() || '—', (current.customerName || '').trim() || '—', 'بيانات')
  push('رقم الهاتف', (previous.customerPhone || '').trim() || '—', (current.customerPhone || '').trim() || '—', 'بيانات')
  push('العنوان', (previous.customerAddress || '').trim() || '—', (current.customerAddress || '').trim() || '—', 'بيانات')
  push('المعلم المسؤول', (previous.responsibleTeacherName || '').trim() || '—', (current.responsibleTeacherName || '').trim() || '—', 'بيانات')

  const prevDiscount = describeDiscount(previous.discount)
  const currDiscount = describeDiscount(current.discount)
  if (prevDiscount !== currDiscount) {
    changes.push({ label: 'الخصم', before: prevDiscount, after: currDiscount })
    tags.add('خصم')
  }

  const prevItems = getInvoiceRecordEditableItems(previous)
  const currItems = getInvoiceRecordEditableItems(current)
  const itemCount = Math.max(prevItems.length, currItems.length)
  for (let i = 0; i < itemCount; i++) {
    const prev = prevItems[i]
    const curr = currItems[i]
    if (!prev && curr) {
      const qty = curr.quantity?.trim() ? curr.quantity.trim() : '—'
      const price = curr.price?.trim() ? `${money(Number(curr.price))} دولار` : '—'
      changes.push({
        label: 'إضافة خدمة',
        text: `${(curr.name || '').trim() || `خدمة #${i + 1}`} (${qty} ${curr.unit || ''} × ${price})${curr.cancelled ? ' — مُلغاة' : ''}`.trim(),
      })
      tags.add('خدمات')
      continue
    }
    if (prev && !curr) {
      changes.push({ label: 'إزالة خدمة', text: `${(prev.name || '').trim() || `خدمة #${i + 1}`} (إزالة من السجل)` })
      tags.add('خدمات')
      continue
    }
    if (!prev || !curr) continue
    const name = correctionItemName(curr.name ? curr : prev, i)
    const itemChanges: string[] = []
    if ((prev.name || '').trim() !== (curr.name || '').trim()) itemChanges.push(`الاسم: ${(prev.name || '').trim() || '—'} ← ${(curr.name || '').trim() || '—'}`)
    if ((prev.unit || '').trim() !== (curr.unit || '').trim()) itemChanges.push(`الوحدة: ${(prev.unit || '').trim() || '—'} ← ${(curr.unit || '').trim() || '—'}`)
    if ((prev.quantity || '').trim() !== (curr.quantity || '').trim()) itemChanges.push(`الكمية: ${(prev.quantity || '').trim() || '—'} ← ${(curr.quantity || '').trim() || '—'}`)
    if ((prev.price || '').trim() !== (curr.price || '').trim()) itemChanges.push(`السعر: ${(prev.price || '').trim() || '—'} ← ${(curr.price || '').trim() || '—'} دولار`)
    if ((prev.notes || '').trim() !== (curr.notes || '').trim()) itemChanges.push(`الملاحظات: ${(prev.notes || '').trim() || '—'} ← ${(curr.notes || '').trim() || '—'}`)
    if (Boolean(prev.cancelled) !== Boolean(curr.cancelled)) itemChanges.push(curr.cancelled ? 'تم إلغاء الخدمة (لن تُحتسب ضمن الإجمالي)' : 'تمت استعادة الخدمة')
    if (itemChanges.length) {
      changes.push({ label: name, text: itemChanges.join(' • ') })
      tags.add(Boolean(prev.cancelled) !== Boolean(curr.cancelled) ? 'إلغاء/استعادة' : 'خدمات')
    }
  }

  const prevPayments = previous.payments || []
  const currPayments = current.payments || []
  const paymentCount = Math.max(prevPayments.length, currPayments.length)
  for (let i = 0; i < paymentCount; i++) {
    const prev = prevPayments[i]
    const curr = currPayments[i]
    if (!prev && curr) {
      changes.push({ label: 'إضافة دفعة', text: describePayment(curr) })
      tags.add('دفعات')
      continue
    }
    if (prev && !curr) {
      changes.push({ label: 'حذف دفعة', text: describePayment(prev) })
      tags.add('دفعات')
      continue
    }
    if (!prev || !curr) continue
    const prevDesc = describePayment(prev)
    const currDesc = describePayment(curr)
    if (prevDesc !== currDesc) {
      changes.push({ label: 'تعديل دفعة', before: prevDesc, after: currDesc })
      tags.add('دفعات')
    }
  }

  const prevNet = getInvoiceNetTotal(previous)
  const currNet = getInvoiceNetTotal(current)
  if (Math.abs(prevNet - currNet) > 0.00001) {
    changes.push({ label: 'صافي الفاتورة', before: `${money(prevNet)} دولار`, after: `${money(currNet)} دولار` })
    tags.add('مبالغ')
  }
  const prevRemaining = getInvoiceRemainingTotal(previous)
  const currRemaining = getInvoiceRemainingTotal(current)
  if (Math.abs(prevRemaining - currRemaining) > 0.00001) {
    changes.push({ label: 'المتبقي', before: `${money(prevRemaining)} دولار`, after: `${money(currRemaining)} دولار` })
    tags.add('دفعات')
  }

  const tagList = [...tags]
  let summary = 'تحديث على الفاتورة'
  const hasBase = tagList.some((tag) => ['خصم', 'خدمات', 'إلغاء/استعادة', 'بيانات', 'مبالغ'].includes(tag)) && (invoiceTermsSignature(previous) !== invoiceTermsSignature(current))
  const hasPayments = tagList.includes('دفعات') && paymentsSignature(previous) !== paymentsSignature(current)
  if (hasBase && hasPayments) summary = 'تعديل الفاتورة وحركة دفعة'
  else if (hasPayments && !hasBase) {
    const added = currPayments.length > prevPayments.length
    const removed = currPayments.length < prevPayments.length
    summary = added ? 'إضافة دفعة' : removed ? 'حذف دفعة' : 'تعديل دفعة'
  } else if (tagList.length === 1) {
    summary = tagList[0] === 'خصم' ? 'تعديل الخصم'
      : tagList[0] === 'خدمات' ? 'تعديل الخدمات'
      : tagList[0] === 'إلغاء/استعادة' ? 'إلغاء/استعادة خدمة'
      : tagList[0] === 'بيانات' ? 'تعديل بيانات الفاتورة'
      : tagList[0] === 'دفعات' ? 'حركة دفعة'
      : 'تعديل مبالغ الفاتورة'
  } else if (tagList.length > 1) {
    const main = tagList.filter((t) => t !== 'مبالغ').slice(0, 2)
    summary = main.length ? `تعديل ${main.join(' و')}` : 'تحديث على الفاتورة'
  }
  if (!changes.length) {
    changes.push({ label: 'تفاصيل', text: 'تم حفظ تحديث على الفاتورة.' })
  }

  const when = current.exportDate || (current.savedAt ? current.savedAt.replace('T', ' ').slice(0, 16) : '')
  return { version: current, when, summary, tags: tagList, changes }
}

async function saveExportedInvoiceRecord(
  ownerId: string,
  data: InvoiceExportData,
  editableItems: StoredInvoiceEditableItem[],
  context?: {
    sourceRecord?: InvoiceRecord
    payments?: InvoicePayment[]
  },
): Promise<void> {
  const nowDate = new Date()
  const now = nowDate.toISOString()
  const exportDate = formatInvoiceDateTime(nowDate)
  data.exportDate = exportDate
  const payments = context?.payments
    ? context.payments.map((payment) => ({ ...payment }))
    : []
  const invoicesCollection = collection(db, 'users', ownerId, 'invoices')
  const sourceRecord = context?.sourceRecord
  const enteredCustomerName = data.customerName.trim().replace(/\s+/g, ' ')
  const currentLinkedCustomer = data.customerId
    ? customers.find((customer) => customer.id === data.customerId)
    : undefined
  const identityMatch = findCustomerIdentityMatch(
    enteredCustomerName,
    data.customerPhone,
    data.customerAddress,
    currentLinkedCustomer?.id,
  )
  if (identityMatch && identityMatch.kind !== 'exact') {
    throw new CustomerIdentityError(customerIdentityMessage(identityMatch, 'invoice'))
  }
  const matchingCustomer = currentLinkedCustomer
    || (identityMatch?.kind === 'exact' ? identityMatch.customer : undefined)
  const newCustomerRef = enteredCustomerName && !matchingCustomer
    ? doc(collection(db, 'users', ownerId, 'customers'))
    : null
  const customerId = matchingCustomer?.id || newCustomerRef?.id || null
  data.customerName = enteredCustomerName
  data.customerId = customerId
  const newCustomerRecord = newCustomerRef ? {
    name: enteredCustomerName,
    phone: data.customerPhone.trim(),
    address: data.customerAddress.trim(),
    notes: '',
    createdAt: now,
    updatedAt: now,
  } : null
  const persistInvoiceRecord = async (ref: DocumentReference, record: Omit<InvoiceRecord, 'id'>) => {
    if (newCustomerRef && newCustomerRecord) {
      const batch = writeBatch(db)
      batch.set(ref, record)
      batch.set(newCustomerRef, newCustomerRecord)
      await batch.commit()
      customers = [...customers, { id: newCustomerRef.id, ...newCustomerRecord }]
      return
    }
    await setDoc(ref, record)
  }
  if (sourceRecord) {
    const rootId = sourceRecord.rootId || sourceRecord.id
    const existing = getInvoiceRootVersions(rootId)
    const nextVersion = Math.max(sourceRecord.version, ...existing.map((record) => record.version), 0) + 1
    const root = existing.find((record) => record.id === rootId) || sourceRecord
    const sharedInvoiceNumber = root.rootInvoiceNumber || root.invoiceNumber || sourceRecord.invoiceNumber
    data.invoiceNumber = sharedInvoiceNumber
    const ref = doc(invoicesCollection)
    const record: Omit<InvoiceRecord, 'id'> = {
      invoiceNumber: sharedInvoiceNumber,
      rootId,
      rootInvoiceNumber: sharedInvoiceNumber,
      parentId: sourceRecord.id,
      version: nextVersion,
      rows: data.rows.map((row) => ({ ...row })),
      unitTotals: data.unitTotals.map((item) => ({ ...item })),
      items: editableItems.map((item) => ({ ...item })),
      total: data.total,
      discount: data.discount ? { ...data.discount } : null,
      exportFormat: data.exportFormat,
      exportDate,
      customerId,
      customerName: data.customerName,
      customerPhone: data.customerPhone,
      customerAddress: data.customerAddress,
      responsibleTeacherName: data.responsibleTeacherName,
      payments,
      savedAt: now,
      createdAt: now,
      updatedAt: now,
    }
    await persistInvoiceRecord(ref, record)
    return
  }
  const ref = doc(invoicesCollection)
  const record: Omit<InvoiceRecord, 'id'> = {
    invoiceNumber: data.invoiceNumber,
    rootId: ref.id,
    rootInvoiceNumber: data.invoiceNumber,
    parentId: null,
    version: 1,
    rows: data.rows.map((row) => ({ ...row })),
    unitTotals: data.unitTotals.map((item) => ({ ...item })),
    items: editableItems.map((item) => ({ ...item })),
    total: data.total,
    discount: data.discount ? { ...data.discount } : null,
    exportFormat: data.exportFormat,
    exportDate,
    customerId,
    customerName: data.customerName,
    customerPhone: data.customerPhone,
    customerAddress: data.customerAddress,
    responsibleTeacherName: data.responsibleTeacherName,
    payments,
    savedAt: now,
    createdAt: now,
    updatedAt: now,
  }
  await persistInvoiceRecord(ref, record)
}

function openInvoiceCustomerExportDialog(
  data: InvoiceExportData,
  ownerId: string,
  context?: {
    sourceRecord?: InvoiceRecord
    editableItems?: StoredInvoiceEditableItem[]
    payments?: InvoicePayment[]
    mode?: 'export-save' | 'save-correction' | 'export-only'
  },
) {
  const mode = context?.mode || 'export-save'
  const isExportOnly = mode === 'export-only'
  const isSaveCorrection = mode === 'save-correction'
  const isExportSave = mode === 'export-save'
  const allowDataEdit = !isExportOnly
  const showFormat = isExportOnly
  const formatAmount = (value: number) => `${money(value)} دولار`
  const fixedInvoiceNumber = context?.sourceRecord
    ? (context.sourceRecord.rootInvoiceNumber || context.sourceRecord.invoiceNumber)
    : null
  if (fixedInvoiceNumber) data.invoiceNumber = fixedInvoiceNumber
  if (context?.payments) data.payments = context.payments.map((payment) => ({ ...payment }))
  if (typeof data.exportNote !== 'string') data.exportNote = ''
  const dialogTitle = isSaveCorrection ? 'تصحيح الفاتورة' : isExportOnly ? 'تصدير الفاتورة' : 'تجهيز نافذة فاتورة'
  const confirmLabel = isSaveCorrection ? 'حفظ التصحيح' : isExportOnly ? 'تصدير' : 'حفظ الفاتورة'
  const backdrop = document.createElement('div')
  backdrop.className = 'invoice-customer-export-backdrop'
  backdrop.innerHTML = `
    <section class="invoice-customer-export-dialog" role="dialog" aria-modal="true" aria-labelledby="invoice-customer-export-title">
      <button type="button" class="invoice-customer-export-close" aria-label="إغلاق">${svg('close')}</button>
      <div class="invoice-customer-export-header">
        <h3 id="invoice-customer-export-title">${dialogTitle} رقم <bdi class="invoice-export-number" dir="ltr">${escapeHtml(data.invoiceNumber)}</bdi></h3>
      </div>
      ${isExportOnly ? `
      <div class="invoice-export-readonly-note modal-note">
        <p>سيتم تصدير الفاتورة الحالية كما هي بدون تعديل بياناتها. يمكنك اختيار نوع التصدير والمعاينة وإضافة ملاحظة اختيارية تُطبع في أسفل الفاتورة.</p>
      </div>` : `
      <div class="invoice-customer-fields">
        <div class="invoice-customer-name-field">
          <label for="invoice-customer-export-name">اسم الزبون <span>(اختياري)</span></label>
          <div class="invoice-customer-name-control">
            <input id="invoice-customer-export-name" type="text" maxlength="80" placeholder="اسم الزبون" autocomplete="name">
            <button type="button" class="invoice-customer-picker-trigger" aria-label="اختيار زبون مسجل" title="اختيار زبون مسجل">
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m7 10 5 5 5-5" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2.2"/></svg>
            </button>
          </div>
        </div>
        <label for="invoice-customer-export-phone">رقم هاتف الزبون <span>(اختياري)</span>
          <input id="invoice-customer-export-phone" type="tel" maxlength="24" inputmode="tel" placeholder="رقم الهاتف" autocomplete="tel">
        </label>
        <label for="invoice-customer-export-address">عنوان الزبون <span>(اختياري)</span>
          <input id="invoice-customer-export-address" type="text" maxlength="100" placeholder="عنوان الزبون">
        </label>
        <label for="invoice-responsible-teacher-name">اسم المعلم المسؤول <span>(اختياري)</span>
          <input id="invoice-responsible-teacher-name" type="text" maxlength="80" placeholder="اسم المعلم المسؤول">
        </label>
      </div>`}
      <div class="invoice-export-summary">
        <div class="invoice-export-count-card"><span>عدد الخدمات</span><strong>${data.rows.filter((row) => !row.cancelled).length}</strong></div>
        <div class="invoice-export-total-card"><span data-invoice-total-label>إجمالي الفاتورة</span><strong data-invoice-total-before>${formatAmount(data.total)}</strong></div>
        <div class="invoice-export-discount-card" hidden><span data-invoice-discount-label>قيمة الخصم</span><strong data-invoice-discount-total>${formatAmount(0)}</strong></div>
        <div class="invoice-export-final-card" hidden><span>الإجمالي بعد الخصم</span><strong data-invoice-total-after>${formatAmount(data.total)}</strong></div>
      </div>
      <div class="invoice-export-controls">
        ${showFormat ? `
        <fieldset class="invoice-export-format">
          <legend>نوع التصدير</legend>
          <label><input type="radio" name="invoice-export-format" value="image-high" checked> صورة فائقة</label>
          <label><input type="radio" name="invoice-export-format" value="image"> صورة عادية</label>
          <label><input type="radio" name="invoice-export-format" value="excel"> ملف Excel</label>
        </fieldset>` : ''}
        ${allowDataEdit ? `
        <fieldset class="invoice-discount-options">
          <legend>تفعيل الخصم</legend>
          <div class="invoice-discount-option">
            <button type="button" data-invoice-discount-mode="amount" aria-pressed="false">خصم مبلغ</button>
            <label class="invoice-discount-value"><input id="invoice-discount-amount" type="number" min="0.01" max="${data.total}" step="0.01" inputmode="decimal" aria-label="قيمة الخصم بالدولار" disabled><span>$</span></label>
          </div>
          <div class="invoice-discount-option">
            <button type="button" data-invoice-discount-mode="percentage" aria-pressed="false">خصم مئوي</button>
            <label class="invoice-discount-value"><input id="invoice-discount-percentage" type="number" min="0.01" max="100" step="0.01" inputmode="decimal" aria-label="نسبة الخصم بالمئة" disabled><span>%</span></label>
          </div>
        </fieldset>` : ''}
        ${isExportOnly ? `
        <label class="invoice-export-note-field" for="invoice-export-note">ملاحظة اختيارية للفاتورة <span>(تُطبع في أسفلها)</span>
          <textarea id="invoice-export-note" maxlength="300" rows="3" placeholder="أدخل ملاحظة اختيارية لتظهر في أسفل الفاتورة">${escapeHtml(data.exportNote || '')}</textarea>
        </label>` : ''}
      </div>
      <div class="invoice-inline-preview" data-invoice-inline-preview hidden>
        <div class="invoice-export-preview-wrap" data-invoice-inline-pages></div>
        <p class="invoice-export-status" data-invoice-inline-status aria-live="polite"></p>
      </div>
      <div class="invoice-customer-export-actions">
        <button type="button" class="secondary-button invoice-customer-export-cancel">إلغاء</button>
        <button type="button" class="secondary-button invoice-customer-export-preview"><span>معاينة</span>${svg('eye')}</button>
        <button type="button" class="primary-button invoice-customer-export-confirm">${confirmLabel}</button>
      </div>
    </section>
  `
  const nameInput = backdrop.querySelector<HTMLInputElement>('#invoice-customer-export-name')
  const phoneInput = backdrop.querySelector<HTMLInputElement>('#invoice-customer-export-phone')
  const addressInput = backdrop.querySelector<HTMLInputElement>('#invoice-customer-export-address')
  const responsibleTeacherInput = backdrop.querySelector<HTMLInputElement>('#invoice-responsible-teacher-name')
  const customerPickerButton = backdrop.querySelector<HTMLButtonElement>('.invoice-customer-picker-trigger')
  const percentageInput = backdrop.querySelector<HTMLInputElement>('#invoice-discount-percentage')
  const amountInput = backdrop.querySelector<HTMLInputElement>('#invoice-discount-amount')
  const exportNoteInput = backdrop.querySelector<HTMLTextAreaElement>('#invoice-export-note')
  const numberLabel = backdrop.querySelector<HTMLElement>('.invoice-export-number')!
  const previewSection = backdrop.querySelector<HTMLElement>('[data-invoice-inline-preview]')!
  const previewPages = backdrop.querySelector<HTMLElement>('[data-invoice-inline-pages]')!
  const previewStatus = backdrop.querySelector<HTMLElement>('[data-invoice-inline-status]')!
  const previewButton = backdrop.querySelector<HTMLButtonElement>('.invoice-customer-export-preview')!
  const confirmButton = backdrop.querySelector<HTMLButtonElement>('.invoice-customer-export-confirm')!
  const closeButton = backdrop.querySelector<HTMLButtonElement>('.invoice-customer-export-close')!
  const cancelButton = backdrop.querySelector<HTMLButtonElement>('.invoice-customer-export-cancel')!
  const formatInputs = [...backdrop.querySelectorAll<HTMLInputElement>('input[name="invoice-export-format"]')]
  const modeButtons = [...backdrop.querySelectorAll<HTMLButtonElement>('[data-invoice-discount-mode]')]
  const summary = backdrop.querySelector<HTMLElement>('.invoice-export-summary')!
  const discountCard = backdrop.querySelector<HTMLElement>('.invoice-export-discount-card')!
  const finalCard = backdrop.querySelector<HTMLElement>('.invoice-export-final-card')!
  const totalLabel = backdrop.querySelector<HTMLElement>('[data-invoice-total-label]')!
  const totalBefore = backdrop.querySelector<HTMLElement>('[data-invoice-total-before]')!
  const discountTotal = backdrop.querySelector<HTMLElement>('[data-invoice-discount-total]')!
  const totalAfter = backdrop.querySelector<HTMLElement>('[data-invoice-total-after]')!
  const discountLabel = backdrop.querySelector<HTMLElement>('[data-invoice-discount-label]')!
  let activeDiscountMode: InvoiceDiscount['mode'] | null = null
  let previewVersion = 0
  let previewUpdateTimer: number | undefined
  let confirmingExport = false
  let committedInvoiceNumber: string | null = fixedInvoiceNumber
  let selectedCustomerId = data.customerId
  let selectedCustomerName = selectedCustomerId
    ? data.customerName.trim() || customers.find((customer) => customer.id === selectedCustomerId)?.name || ''
    : ''
  let closeCustomerPicker: ((restoreFocus?: boolean) => void) | null = null

  if (nameInput) nameInput.value = data.customerName || ''
  if (phoneInput) phoneInput.value = data.customerPhone || ''
  if (addressInput) addressInput.value = data.customerAddress || ''
  if (selectedCustomerId) {
    if (phoneInput) phoneInput.disabled = true
    if (addressInput) addressInput.disabled = true
  }
  if (responsibleTeacherInput) responsibleTeacherInput.value = data.responsibleTeacherName || ''
  if (exportNoteInput) exportNoteInput.value = data.exportNote || ''
  formatInputs.forEach((input) => { input.checked = input.value === data.exportFormat })
  if (allowDataEdit && data.discount) {
    activeDiscountMode = data.discount.mode
    if (data.discount.mode === 'percentage' && percentageInput) percentageInput.value = String(data.discount.value)
    else if (data.discount.mode === 'amount' && amountInput) amountInput.value = String(data.discount.value)
  }

  const getActiveDiscount = (): InvoiceDiscount | null => {
    if (!allowDataEdit) return data.discount ? { ...data.discount } : null
    if (!activeDiscountMode) return null
    const input = activeDiscountMode === 'percentage' ? percentageInput : amountInput
    if (!input || !input.value.trim()) return null
    const value = Number(input.value)
    if (!Number.isFinite(value) || value <= 0) return null
    const discountValue = activeDiscountMode === 'percentage' ? Math.min(value, 100) : Math.min(value, data.total)
    const rawAmount = activeDiscountMode === 'percentage' ? data.total * discountValue / 100 : discountValue
    const amount = Number(Math.min(data.total, rawAmount).toFixed(2))
    return amount > 0 ? { mode: activeDiscountMode, value: discountValue, amount } : null
  }
  const renderDiscountSummary = () => {
    const discount = getActiveDiscount()
    modeButtons.forEach((modeButton) => {
      const selected = modeButton.dataset.invoiceDiscountMode === activeDiscountMode
      modeButton.setAttribute('aria-pressed', String(selected))
      modeButton.classList.toggle('is-active', selected)
    })
    if (percentageInput) percentageInput.disabled = activeDiscountMode !== 'percentage'
    if (amountInput) amountInput.disabled = activeDiscountMode !== 'amount'
    const netTotal = data.total - (discount?.amount || 0)
    totalLabel.textContent = discount ? 'الإجمالي قبل الخصم' : 'إجمالي الفاتورة'
    summary.classList.toggle('has-discount', Boolean(discount))
    discountCard.hidden = !discount
    finalCard.hidden = !discount
    totalBefore.textContent = formatAmount(data.total)
    discountTotal.textContent = formatAmount(discount?.amount || 0)
    totalAfter.textContent = formatAmount(netTotal)
    discountLabel.textContent = discount?.mode === 'percentage' ? `قيمة الخصم (${discount.value}%)` : 'قيمة الخصم'
  }
  const getFormatLabel = () => {
    const selectedFormat = formatInputs.find((input) => input.checked)?.value
    return selectedFormat === 'excel'
      ? 'ملف Excel'
      : selectedFormat === 'image-high'
        ? 'صورة فائقة'
        : 'صورة عادية'
  }
  const syncExportData = (notifyInvalid = false) => {
    if (allowDataEdit && activeDiscountMode && !getActiveDiscount()) {
      if (notifyInvalid) showToast('أدخل قيمة خصم صحيحة قبل المتابعة، أو ألغِ تفعيل الخصم.')
      return false
    }
    const discount = getActiveDiscount()
    const netTotal = data.total - (discount?.amount || 0)
    const carriedPayments = context?.payments ? context.payments.map((payment) => ({ ...payment })) : null
    if (carriedPayments) {
      const paidTotal = carriedPayments.reduce((sum, payment) => sum + (Number.isFinite(payment.amount) ? payment.amount : 0), 0)
      if (paidTotal - netTotal > 0.00001) {
        if (notifyInvalid) {
          showToast(`إجمالي الدفعات المسجلة (${money(paidTotal)} دولار) أكبر من صافي الفاتورة (${money(netTotal)} دولار). عدّل الخصم/الإجمالي بما يتوافق مع الدفعات.`)
        }
        return false
      }
    }
    if (allowDataEdit) {
      data.customerName = nameInput?.value.trim() || ''
      data.customerPhone = phoneInput?.value.trim() || ''
      data.customerAddress = addressInput?.value.trim() || ''
      data.customerId = selectedCustomerId
      data.responsibleTeacherName = responsibleTeacherInput?.value.trim() || ''
      data.discount = discount
      if (carriedPayments) {
        data.payments = carriedPayments
        const paidTotal = carriedPayments.reduce((sum, payment) => sum + (Number.isFinite(payment.amount) ? payment.amount : 0), 0)
        const lastPayment = carriedPayments[carriedPayments.length - 1]
        data.upfrontPayment = lastPayment ? lastPayment.amount : (paidTotal > 0 ? paidTotal : null)
        data.upfrontPaymentDate = lastPayment?.date || data.upfrontPaymentDate
      } else {
        data.upfrontPayment = null
        data.upfrontPaymentDate = ''
        data.payments = []
      }
    }
    if (showFormat) {
      const selectedFormat = formatInputs.find((input) => input.checked)?.value
      data.exportFormat = selectedFormat === 'image-high' || selectedFormat === 'excel' ? selectedFormat : 'image'
    }
    if (isExportOnly) {
      data.exportNote = (exportNoteInput?.value || '').trim()
    } else {
      data.exportNote = ''
    }
    return true
  }
  const invalidatePreview = () => {
    if (confirmingExport) return
    previewVersion += 1
    if (previewSection.hidden) return
    previewStatus.textContent = 'جارٍ تحديث المعاينة...'
    if (previewUpdateTimer !== undefined) window.clearTimeout(previewUpdateTimer)
    previewUpdateTimer = window.setTimeout(() => {
      previewUpdateTimer = undefined
      void renderPreview()
    }, 100)
  }
  customerPickerButton?.addEventListener('click', () => {
    if (closeCustomerPicker) return
    const pickerBackdrop = document.createElement('div')
    pickerBackdrop.className = 'invoice-customer-picker-backdrop'
    pickerBackdrop.innerHTML = `
      <section class="invoice-customer-picker-dialog" role="dialog" aria-modal="true" aria-labelledby="invoice-customer-picker-title">
        <header class="invoice-customer-picker-header">
          <div>
            <p>الزبائن</p>
            <h3 id="invoice-customer-picker-title">اختيار زبون مسجل</h3>
          </div>
          <button type="button" class="invoice-customer-picker-close" aria-label="إغلاق">${svg('close')}</button>
        </header>
        <label class="invoice-customer-picker-search">
          <input type="search" placeholder="ابحث عن اسم أو هاتف الزبون" aria-label="ابحث عن زبون">
        </label>
        <div class="invoice-customer-picker-list" role="listbox" aria-label="الزبائن المسجلون"></div>
        <p class="invoice-customer-picker-empty" hidden></p>
      </section>`
    const searchInput = pickerBackdrop.querySelector<HTMLInputElement>('.invoice-customer-picker-search input')!
    const customerList = pickerBackdrop.querySelector<HTMLElement>('.invoice-customer-picker-list')!
    const emptyState = pickerBackdrop.querySelector<HTMLElement>('.invoice-customer-picker-empty')!
    const closeButton = pickerBackdrop.querySelector<HTMLButtonElement>('.invoice-customer-picker-close')!
    const renderCustomers = () => {
      const search = searchInput.value.trim().toLocaleLowerCase('ar')
      const visibleCustomers = [...customers]
        .filter((customer) => [customer.name, customer.phone, customer.address]
          .join(' ')
          .toLocaleLowerCase('ar')
          .includes(search))
        .sort((a, b) => a.name.localeCompare(b.name, 'ar'))
      customerList.innerHTML = visibleCustomers.map((customer) => `
        <button type="button" class="invoice-customer-picker-option" role="option" data-customer-id="${escapeHtml(customer.id)}">
          <span class="invoice-customer-picker-option-main">
            <strong>${escapeHtml(customer.name)}</strong>
            <span class="invoice-customer-picker-contact">
              <span>${customer.phone ? escapeHtml(customer.phone) : 'بدون رقم هاتف'}</span>
              ${customer.address ? `<span class="invoice-customer-picker-contact-separator" aria-hidden="true">|</span><span class="invoice-customer-picker-address">${escapeHtml(customer.address)}</span>` : ''}
            </span>
          </span>
          <span class="invoice-customer-picker-option-arrow" aria-hidden="true">‹</span>
        </button>`).join('')
      emptyState.textContent = customers.length
        ? 'لا توجد نتائج مطابقة لبحثك.'
        : 'لا يوجد زبائن مسجلون بعد. يمكنك إدخال الاسم يدويًا.'
      emptyState.hidden = visibleCustomers.length > 0
    }
    const closePicker = (restoreFocus = true) => {
      pickerBackdrop.remove()
      closeCustomerPicker = null
      if (restoreFocus && customerPickerButton?.isConnected) customerPickerButton.focus()
    }
    closeCustomerPicker = closePicker
    closeButton.addEventListener('click', () => closePicker())
    pickerBackdrop.addEventListener('click', (event) => {
      if (event.target === pickerBackdrop) closePicker()
    })
    searchInput.addEventListener('input', renderCustomers)
    customerList.addEventListener('click', (event) => {
      if (!(event.target instanceof Element)) return
      const option = event.target.closest<HTMLButtonElement>('[data-customer-id]')
      const customer = customers.find((item) => item.id === option?.dataset.customerId)
      if (!customer || !nameInput || !phoneInput || !addressInput) return
      selectedCustomerId = customer.id
      selectedCustomerName = customer.name
      data.customerId = customer.id
      nameInput.value = customer.name
      phoneInput.value = customer.phone
      addressInput.value = customer.address
      phoneInput.disabled = true
      addressInput.disabled = true
      invalidatePreview()
      closePicker()
    })
    renderCustomers()
    document.body.append(pickerBackdrop)
  })
  const renderPreview = async (notifyInvalid = false) => {
    if (previewUpdateTimer !== undefined) {
      window.clearTimeout(previewUpdateTimer)
      previewUpdateTimer = undefined
    }
    const revision = ++previewVersion
    previewSection.hidden = false
    previewStatus.textContent = 'جارٍ إعداد المعاينة...'
    if (!syncExportData(notifyInvalid)) {
      previewPages.replaceChildren()
      previewStatus.textContent = 'تحقق من البيانات المدخلة قبل معاينة الفاتورة.'
      return false
    }
    try {
      const canvases = await renderInvoiceCanvases(data, 1)
      if (!backdrop.isConnected || revision !== previewVersion) return false
      previewPages.replaceChildren(...canvases)
      canvases.forEach((canvas, index) => {
        canvas.className = 'invoice-export-preview-page'
        canvas.setAttribute('role', 'img')
        canvas.setAttribute('aria-label', `معاينة صفحة الفاتورة ${index + 1}`)
      })
      previewStatus.textContent = ''
      return true
    } catch (error) {
      if (backdrop.isConnected && revision === previewVersion) {
        console.error('Failed to render invoice preview:', error)
        previewStatus.textContent = 'تعذر إعداد المعاينة. حاول مجددًا.'
      }
      return false
    }
  }
  const hidePreview = () => {
    previewVersion += 1
    if (previewUpdateTimer !== undefined) {
      window.clearTimeout(previewUpdateTimer)
      previewUpdateTimer = undefined
    }
    previewSection.hidden = true
    previewPages.replaceChildren()
    previewStatus.textContent = ''
    previewButton.innerHTML = `<span>معاينة</span>${svg('eye')}`
  }
  const setFormDisabled = (disabled: boolean) => {
    ;[
      nameInput,
      phoneInput,
      addressInput,
      customerPickerButton,
      responsibleTeacherInput,
      percentageInput,
      amountInput,
      exportNoteInput,
      ...formatInputs,
      ...modeButtons,
    ].filter((control): control is HTMLInputElement | HTMLButtonElement | HTMLTextAreaElement => Boolean(control)).forEach((control) => {
      control.disabled = disabled
    })
    if (phoneInput) phoneInput.disabled = disabled || Boolean(selectedCustomerId)
    if (addressInput) addressInput.disabled = disabled || Boolean(selectedCustomerId)
    if (!disabled) renderDiscountSummary()
  }
  modeButtons.forEach((modeButton) => {
    modeButton.addEventListener('click', () => {
      const nextMode = modeButton.dataset.invoiceDiscountMode
      if (nextMode !== 'percentage' && nextMode !== 'amount') return
      const previousMode = activeDiscountMode
      activeDiscountMode = previousMode === nextMode ? null : nextMode
      if (previousMode && previousMode !== activeDiscountMode) {
        const previousInput = previousMode === 'percentage' ? percentageInput : amountInput
        if (previousInput) previousInput.value = ''
      }
      renderDiscountSummary()
      invalidatePreview()
    })
  })
  percentageInput?.addEventListener('input', () => {
    const value = Number(percentageInput.value)
    if (Number.isFinite(value) && value > 100) percentageInput.value = '100'
    renderDiscountSummary()
    invalidatePreview()
  })
  amountInput?.addEventListener('input', () => {
    const value = Number(amountInput.value)
    if (Number.isFinite(value) && value > data.total) amountInput.value = String(data.total)
    renderDiscountSummary()
    invalidatePreview()
  })
  nameInput?.addEventListener('input', () => {
    if (selectedCustomerId && nameInput.value.trim() !== selectedCustomerName) {
      selectedCustomerId = null
      selectedCustomerName = ''
      data.customerId = null
      if (phoneInput) {
        phoneInput.value = ''
        phoneInput.disabled = false
      }
      if (addressInput) {
        addressInput.value = ''
        addressInput.disabled = false
      }
    }
    invalidatePreview()
  })
  ;[phoneInput, addressInput, responsibleTeacherInput].forEach((input) =>
    input?.addEventListener('input', invalidatePreview))
  formatInputs.forEach((input) => input.addEventListener('change', invalidatePreview))
  exportNoteInput?.addEventListener('input', invalidatePreview)
  previewButton.addEventListener('click', () => {
    if (!previewSection.hidden) {
      hidePreview()
      return
    }
    previewButton.innerHTML = `<span>إلغاء المعاينة</span>${svg('eye-off')}`
    void renderPreview(true).then((rendered) => {
      if (rendered && !previewSection.hidden) {
        previewSection.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
      }
    })
  })
  renderDiscountSummary()
  const closeDialog = () => {
    if (previewUpdateTimer !== undefined) window.clearTimeout(previewUpdateTimer)
    document.removeEventListener('keydown', handleDialogKeydown)
    closeCustomerPicker?.(false)
    backdrop.remove()
  }
  const handleDialogKeydown = (event: KeyboardEvent) => {
    if (event.key === 'Escape' && !confirmingExport) {
      if (closeCustomerPicker) closeCustomerPicker()
      else closeDialog()
    }
  }
  closeButton.addEventListener('click', () => {
    if (!confirmingExport) closeDialog()
  })
  cancelButton.addEventListener('click', () => {
    if (!confirmingExport) closeDialog()
  })
  let exportedSuccessfully = false
  let savedSuccessfully = false
  let linkedExistingCustomer = false
  const resolveInvoiceCustomer = () => {
    const linkedCustomer = selectedCustomerId
      ? customers.find((customer) => customer.id === selectedCustomerId)
      : undefined
    const identityMatch = findCustomerIdentityMatch(
      data.customerName,
      data.customerPhone,
      data.customerAddress,
      linkedCustomer?.id,
    )
    if (identityMatch && identityMatch.kind !== 'exact') {
      const message = customerIdentityMessage(identityMatch, 'invoice')
      previewStatus.textContent = message
      showToast(message)
      return false
    }
    if (identityMatch?.kind === 'exact') {
      const customer = identityMatch.customer
      selectedCustomerId = customer.id
      selectedCustomerName = customer.name
      data.customerId = customer.id
      data.customerName = customer.name
      data.customerPhone = customer.phone
      data.customerAddress = customer.address
      if (nameInput) nameInput.value = customer.name
      if (phoneInput) {
        phoneInput.value = customer.phone
        phoneInput.disabled = true
      }
      if (addressInput) {
        addressInput.value = customer.address
        addressInput.disabled = true
      }
      linkedExistingCustomer = true
      showToast(customerIdentityMessage(identityMatch, 'invoice'))
    }
    return true
  }
  confirmButton.addEventListener('click', async () => {
    if (confirmingExport) return
    if (!syncExportData(true)) return
    if (allowDataEdit && !resolveInvoiceCustomer()) return
    confirmingExport = true
    previewVersion += 1
    if (previewUpdateTimer !== undefined) {
      window.clearTimeout(previewUpdateTimer)
      previewUpdateTimer = undefined
    }
    confirmButton.disabled = true
    previewButton.disabled = true
    closeButton.disabled = true
    cancelButton.disabled = true
    if (!exportedSuccessfully && !committedInvoiceNumber) setFormDisabled(true)
    try {
      if (dataUserId !== ownerId) throw new Error('Invoice owner changed before export confirmation')

      if (mode === 'export-only') {
        previewStatus.textContent = `جارٍ تصدير الفاتورة بصيغة ${getFormatLabel()}...`
        const successful = data.exportFormat === 'excel'
          ? await exportInvoiceToExcel(confirmButton, data)
          : await exportInvoiceImage(confirmButton, data, data.exportFormat === 'image-high' ? 2 : 1)
        if (!successful) {
          previewStatus.textContent = 'تعذر تصدير الفاتورة. يمكنك المحاولة مجددًا.'
          return
        }
        closeDialog()
        showToast('تم تصدير الفاتورة بنجاح.')
        return
      }

      if (mode === 'save-correction') {
        previewStatus.textContent = 'جارٍ حفظ تصحيح الفاتورة في السجل...'
        await saveExportedInvoiceRecord(ownerId, data, context?.editableItems || [], { sourceRecord: context?.sourceRecord, payments: context?.payments })
        closeDialog()
        showToast(linkedExistingCustomer
          ? 'تم حفظ التصحيح وربط الفاتورة بالزبون المسجل.'
          : 'تم حفظ تصحيح الفاتورة في السجل.')
        return
      }

      if (isExportSave) {
        if (!committedInvoiceNumber) {
          previewStatus.textContent = 'جارٍ حجز رقم الفاتورة...'
          committedInvoiceNumber = await getNextInvoiceNumber(ownerId)
          if (!backdrop.isConnected || dataUserId !== ownerId) return
          data.invoiceNumber = committedInvoiceNumber
          numberLabel.textContent = data.invoiceNumber
          if (!previewSection.hidden) await renderPreview()
        }
        previewStatus.textContent = 'جارٍ حفظ الفاتورة في السجل...'
        await saveExportedInvoiceRecord(ownerId, data, context?.editableItems || [], { sourceRecord: context?.sourceRecord, payments: context?.payments })
        savedSuccessfully = true
        closeDialog()
        showToast(linkedExistingCustomer
          ? 'تم حفظ الفاتورة وربطها بالزبون المسجل.'
          : 'تم حفظ الفاتورة في السجل بنجاح.')
        return
      }

      if (!exportedSuccessfully) {
        if (!committedInvoiceNumber) {
          previewStatus.textContent = 'جارٍ تثبيت رقم الفاتورة...'
          committedInvoiceNumber = await getNextInvoiceNumber(ownerId)
        }
        if (!backdrop.isConnected || dataUserId !== ownerId) return
        if (data.invoiceNumber !== committedInvoiceNumber) {
          data.invoiceNumber = committedInvoiceNumber
          numberLabel.textContent = data.invoiceNumber
          if (!previewSection.hidden) await renderPreview()
        } else {
          numberLabel.textContent = data.invoiceNumber
        }
        previewStatus.textContent = `جارٍ تصدير الفاتورة بصيغة ${getFormatLabel()}...`
        const successful = data.exportFormat === 'excel'
          ? await exportInvoiceToExcel(confirmButton, data)
          : await exportInvoiceImage(confirmButton, data, data.exportFormat === 'image-high' ? 2 : 1)
        if (!successful) {
          previewStatus.textContent = 'تعذر تصدير الفاتورة. يمكنك المحاولة مجددًا.'
          return
        }
        exportedSuccessfully = true
        confirmButton.textContent = 'إعادة محاولة الحفظ'
        setFormDisabled(true)
      }
      previewStatus.textContent = 'جارٍ حفظ الفاتورة في السجل...'
      await saveExportedInvoiceRecord(ownerId, data, context?.editableItems || [], { sourceRecord: context?.sourceRecord, payments: context?.payments })
      closeDialog()
      showToast(linkedExistingCustomer
        ? 'تم تصدير الفاتورة وحفظها وربطها بالزبون المسجل.'
        : 'تم تصدير الفاتورة وحفظها في السجل بنجاح.')
    } catch (error) {
      console.error('Failed to confirm invoice export/save:', error)
      if (error instanceof CustomerIdentityError) {
        previewStatus.textContent = error.message
        showToast(error.message)
      } else if (isExportSave && committedInvoiceNumber) {
        previewStatus.textContent = 'تعذر حفظ الفاتورة في السجل. يمكنك الضغط على "حفظ الفاتورة" لإعادة المحاولة بنفس الرقم.'
        showToast('تعذر حفظ الفاتورة في السجل.')
      } else if (exportedSuccessfully) {
        previewStatus.textContent = 'تم تصدير الفاتورة، لكن تعذر حفظها في السجل. يمكنك الضغط على "إعادة محاولة الحفظ" دون إعادة التصدير.'
        showToast('تم تصدير الفاتورة لكن تعذر حفظها في السجل.')
      } else {
        previewStatus.textContent = friendlyError(error) || 'تعذر إتمام العملية. حاول مجددًا.'
      }
    } finally {
      confirmingExport = false
      if (backdrop.isConnected && !savedSuccessfully) {
        if (mode === 'export-only' || mode === 'save-correction') {
          setFormDisabled(false)
          previewButton.disabled = false
          confirmButton.textContent = confirmLabel
        } else if (isExportSave) {
          if (committedInvoiceNumber) {
            setFormDisabled(true)
            previewButton.disabled = true
          } else {
            setFormDisabled(false)
            previewButton.disabled = false
          }
          confirmButton.textContent = confirmLabel
        } else if (!exportedSuccessfully) {
          setFormDisabled(false)
          previewButton.disabled = false
          confirmButton.textContent = confirmLabel
        } else {
          setFormDisabled(true)
          previewButton.disabled = true
          confirmButton.textContent = 'إعادة محاولة الحفظ'
        }
        closeButton.disabled = false
        cancelButton.disabled = false
        confirmButton.disabled = false
      }
    }
  })
  backdrop.addEventListener('click', (event) => {
    if (event.target === backdrop && !confirmingExport) closeDialog()
  })
  document.addEventListener('keydown', handleDialogKeydown)
  document.body.append(backdrop)
  cancelButton.focus()
}

function renderExportDialog(options?: { sourceRecord?: InvoiceRecord; savePayments?: InvoicePayment[]; correction?: boolean }) {
  if (!workServices.length && !options?.sourceRecord) {
    showToast('لا توجد خدمات للتصدير.')
    return
  }
  const correctionInvoiceNumber = options?.correction && options.sourceRecord
    ? options.sourceRecord.rootInvoiceNumber || options.sourceRecord.invoiceNumber
    : ''
  const selected = new Set<string>()
  const exportPrices = new Map(workServices.map((service) => [service.id, service.price]))
  const modified = new Set<string>()
  const element = modal(`
    <button class="modal-close" aria-label="إغلاق">${svg('close')}</button>
    <p class="eyebrow">${options?.correction ? 'تعديل فاتورة' : 'تجهيز فاتورة'}</p>
    <h2>${options?.correction ? `تصحيح الفاتورة رقم ${escapeHtml(correctionInvoiceNumber)}` : 'تجهيز نافذة فاتورة'}</h2>
    <div class="export-tabs">
      <button class="active" type="button" data-export-tab="invoice">حساب فاتورة</button>
      <button type="button" data-export-tab="services">الخدمات</button>
    </div>
    <div id="export-services-panel" hidden class="hidden">
      <div class="export-service-list"></div>
      <div class="export-summary" aria-live="polite"></div>
      <div class="export-grid">
        <button class="secondary-button" id="export-png" type="button">صورة</button>
        <button class="primary-button" id="export-png-high" type="button">صورة فائقة</button>
        <button class="secondary-button" id="export-excel" type="button">ملف Excel</button>
      </div>
    </div>
    <div id="export-invoice-panel"></div>`)
  element.querySelector('.modal-close')!.addEventListener('click', () => element.remove())
  const list = element.querySelector<HTMLElement>('.export-service-list')!
  const summary = element.querySelector<HTMLElement>('.export-summary')!
  const invoicePanel = element.querySelector<HTMLElement>('#export-invoice-panel')!
  type InvoiceItem = {
    id: number
    custom: boolean
    name: string
    notes: string
    quantity: string
    price: string
    unit: string
    unitCode: ServiceUnit | null
    currencyCode: string
    cancelled: boolean
  }
  const invoiceItems: InvoiceItem[] = []
  let nextInvoiceItemId = 1
  if (options?.sourceRecord) {
    const sourceItems = options.sourceRecord.items.length
      ? options.sourceRecord.items
      : options.sourceRecord.rows.map((row) => ({
        custom: true,
        name: row.name,
        notes: row.notes,
        quantity: String(row.quantity),
        price: String(row.unitPrice),
        unit: row.unit,
        unitCode: null as ServiceUnit | null,
        currencyCode: 'USD',
        cancelled: row.cancelled === true,
      }))
    sourceItems.forEach((item) => {
      invoiceItems.push({
        id: nextInvoiceItemId++,
        custom: item.custom,
        name: item.name,
        notes: item.notes,
        quantity: item.quantity,
        price: item.price,
        unit: item.unit,
        unitCode: item.unitCode,
        currencyCode: item.currencyCode || 'USD',
        cancelled: item.cancelled === true,
      })
    })
  }
  let exportDialogOpening = false
  const invoiceCurrencyName = invoiceCurrencyLabel
  const renderInvoice = () => {
    const sortedServices = [...workServices].sort((a, b) => a.name.localeCompare(b.name, 'ar'))
    invoicePanel.innerHTML = `
      <div class="invoice-workspace">
        <div class="invoice-items">
          ${invoiceItems.map(({ id, custom, name, notes, quantity, price, unit, currencyCode, cancelled }, index) => `
            <article class="invoice-service-card${cancelled ? ' is-cancelled' : ''}" data-invoice-item="${id}">
              <span class="service-order invoice-card-order" aria-label="ترتيب الخدمة ${index + 1} في الفاتورة">${index + 1}</span>
              <div class="invoice-card-header">
                ${custom
                  ? `<input class="invoice-custom-name" type="text" data-invoice-name="${id}" value="${escapeHtml(name)}" aria-label="اسم الخدمة غير المسجلة" placeholder="اسم الخدمة">`
                  : `<h3>${escapeHtml(name)}</h3>`}
                <button class="invoice-cancel-service${cancelled ? ' is-cancelled' : ''}" type="button" data-invoice-cancel="${id}" aria-label="${cancelled ? 'استعادة' : 'إلغاء'} ${escapeHtml(name || 'الخدمة')}" title="${cancelled ? 'استعادة الخدمة' : 'إلغاء الخدمة'}">
                  <span>${cancelled ? 'استعادة' : 'إلغاء'}</span>
                </button>
              </div>
              <input class="invoice-notes-field" type="text" data-invoice-notes="${id}" value="${escapeHtml(notes)}" placeholder="أضف ملاحظة عن الخدمة" aria-label="ملاحظات الخدمة">
              <div class="invoice-service-fields">
                <div class="invoice-field invoice-quantity-field">
                  <span class="invoice-field-heading">
                    <span class="invoice-quantity-heading">الكمية</span>
                    <span class="invoice-unit-group">
                      ${custom
                        ? `<input class="invoice-unit-cell invoice-unit-input" type="text" data-invoice-unit="${id}" value="${escapeHtml(unit)}" aria-label="وحدة القياس" placeholder="الوحدة">`
                        : `<span class="invoice-unit-cell invoice-unit-label">${escapeHtml(unit)}</span>`}
                    </span>
                  </span>
                  <input type="number" min="0" step="any" inputmode="decimal" data-invoice-quantity="${id}" value="${escapeHtml(quantity)}" placeholder="الكمية" aria-label="الكمية">
                </div>
                <label class="invoice-field invoice-price-field">
                  <span class="invoice-price-heading">سعر الوحدة</span>
                  <span class="invoice-price-row">
                    <input class="invoice-price-input" type="number" min="0" step="any" inputmode="decimal" data-invoice-price="${id}" value="${escapeHtml(price)}" placeholder="السعر" aria-label="سعر الوحدة">
                    <span class="invoice-currency-cell">${escapeHtml(invoiceCurrencyName(currencyCode))}</span>
                  </span>
                </label>
              </div>
              <div class="invoice-line-total">
                <strong data-invoice-total>—</strong>
                <small data-invoice-calculation>${cancelled ? 'خدمة مُلغاة (غير محتسبة في الإجمالي)' : 'أدخل الكمية والسعر لحساب الإجمالي'}</small>
              </div>
            </article>
          `).join('')}
        </div>
        <div class="invoice-service-picker">
          <button class="invoice-picker-trigger" type="button" data-invoice-picker-trigger aria-haspopup="dialog" aria-controls="invoice-service-picker-menu" aria-expanded="false">
            <span class="invoice-picker-plus" aria-hidden="true">+</span>
            <span class="invoice-picker-trigger-text">
              <strong>إضافة خدمة إلى الفاتورة</strong>
              <small>اختر من قائمة الخدمات المسجلة</small>
            </span>
            <span class="invoice-picker-chevron" aria-hidden="true">⌄</span>
          </button>
          <div class="invoice-service-picker-menu" id="invoice-service-picker-menu" role="dialog" aria-label="اختيار خدمة" hidden>
            <label class="invoice-picker-search">
              <input type="search" data-invoice-search aria-label="ابحث عن خدمة" placeholder="ابحث عن اسم الخدمة...">
            </label>
            <button class="invoice-picker-custom" type="button" data-invoice-custom>
              <span class="invoice-picker-custom-plus" aria-hidden="true">+</span>
              <span>
                <strong>إضافة خدمة غير مسجلة</strong>
                <small>أدخل اسمها ووحدتها وسعرها يدويًا</small>
              </span>
            </button>
            <div class="invoice-picker-options" role="listbox" aria-label="الخدمات المسجلة">
              ${sortedServices.map((service) => {
                const usdPrice = invoicePriceInUsd(service)
                return `
                <button class="invoice-service-option" type="button" role="option" data-invoice-choice="${escapeHtml(service.id)}" ${usdPrice === null ? 'disabled' : ''}>
                  <span class="invoice-option-details">
                    <strong>${escapeHtml(service.name)}</strong>
                    <small>${escapeHtml(serviceUnitLabel(service.unit))}</small>
                  </span>
                  <strong class="invoice-option-price">${usdPrice === null ? 'يلزم سعر الصرف' : `${money(usdPrice)} دولار`}</strong>
                </button>`
              }).join('')}
            </div>
            <p class="invoice-picker-empty" ${sortedServices.length ? 'hidden' : ''}>${sortedServices.length ? 'لا توجد خدمات مطابقة لبحثك' : 'لا توجد خدمات مسجلة'}</p>
          </div>
        </div>
      </div>
      <div class="invoice-footer">
        <div class="invoice-quantity-summary">
          <span>إجمالي الكميات</span>
          <ul data-invoice-unit-totals></ul>
        </div>
        <div class="invoice-footer-actions">
          <div class="invoice-net" aria-live="polite">
            <span>الصافي المطلوب</span>
            <strong data-invoice-net>—</strong>
          </div>
          <button class="primary-button invoice-export-button" type="button" data-invoice-export>
            ${options?.correction ? 'متابعة التصحيح' : 'متابعة التجهيز'}
          </button>
        </div>
      </div>`

    updateInvoiceTotals()
  }
  const fitInvoiceSummaryText = (element: HTMLElement, maxFontSize: number, minFontSize: number) => {
    if (!element.clientWidth) return
    let min = minFontSize
    let max = maxFontSize
    element.style.fontSize = `${max}px`
    if (element.scrollWidth <= element.clientWidth) return
    for (let iteration = 0; iteration < 8; iteration += 1) {
      const fontSize = (min + max) / 2
      element.style.fontSize = `${fontSize}px`
      if (element.scrollWidth <= element.clientWidth) min = fontSize
      else max = fontSize
    }
    element.style.fontSize = `${Math.floor(min * 10) / 10}px`
  }
  const updateInvoiceTotals = () => {
    const totals = new Map<string, number>()
    invoiceItems.forEach(({ id, name, unit, quantity, price, currencyCode, cancelled }) => {
      const card = invoicePanel.querySelector<HTMLElement>(`[data-invoice-item="${id}"]`)
      const totalElement = card?.querySelector<HTMLElement>('[data-invoice-total]')
      const calculationElement = card?.querySelector<HTMLElement>('[data-invoice-calculation]')
      const trimmedQuantity = quantity.trim()
      const numericQuantity = trimmedQuantity ? Number(trimmedQuantity) : null
      const trimmedPrice = price.trim()
      const numericPrice = trimmedPrice ? Number(trimmedPrice) : null
      const lineTotal = numericQuantity !== null && numericPrice !== null
        ? numericQuantity * numericPrice
        : Number.NaN
      const isComplete = Boolean(name.trim() && unit.trim())
        && numericQuantity !== null
        && Number.isFinite(numericQuantity)
        && numericQuantity >= 0
        && numericPrice !== null
        && Number.isFinite(numericPrice)
        && numericPrice >= 0
        && Number.isFinite(lineTotal)
      card?.classList.toggle('is-incomplete', !cancelled && !isComplete)
      if (cancelled) {
        if (Number.isFinite(numericQuantity) && Number.isFinite(numericPrice) && numericQuantity! >= 0 && numericPrice! >= 0) {
          if (totalElement) totalElement.textContent = `ملغاة (${money(lineTotal)} ${invoiceCurrencyName(currencyCode)})`
          if (calculationElement) calculationElement.textContent = 'خدمة مُلغاة — غير محتسبة في الإجمالي'
        } else {
          if (totalElement) totalElement.textContent = 'ملغاة'
          if (calculationElement) calculationElement.textContent = 'خدمة مُلغاة — غير محتسبة في الإجمالي'
        }
        return
      }
      if (numericQuantity === null) {
        if (totalElement) totalElement.textContent = '—'
        if (calculationElement) {
          calculationElement.textContent = numericPrice === null
            ? 'أدخل الكمية والسعر لحساب الإجمالي'
            : 'أدخل الكمية لحساب الإجمالي'
        }
        return
      }
      if (!Number.isFinite(numericQuantity) || numericQuantity < 0) {
        if (totalElement) totalElement.textContent = '—'
        if (calculationElement) calculationElement.textContent = 'أدخل كمية صحيحة غير سالبة'
        return
      }
      if (numericPrice === null) {
        if (totalElement) totalElement.textContent = '—'
        if (calculationElement) calculationElement.textContent = 'أدخل سعر الوحدة لحساب الإجمالي'
        return
      }
      if (!Number.isFinite(numericPrice) || numericPrice < 0) {
        if (totalElement) totalElement.textContent = '—'
        if (calculationElement) calculationElement.textContent = 'أدخل سعرًا صحيحًا غير سالب'
        return
      }
      if (totalElement) totalElement.textContent = `${money(lineTotal)} ${invoiceCurrencyName(currencyCode)}`
      if (calculationElement) {
        calculationElement.textContent = `${money(numericQuantity)} × ${money(numericPrice)} = ${money(lineTotal)} ${invoiceCurrencyName(currencyCode)}`
      }
      totals.set(currencyCode, (totals.get(currencyCode) ?? 0) + lineTotal)
    })
    const netElement = invoicePanel.querySelector<HTMLElement>('[data-invoice-net]')
    if (netElement) {
      netElement.innerHTML = totals.size
        ? [...totals].map(([, total]) =>
          `<span>${money(total)} دولار</span>${settings.syriaEnabled && settings.exchangeRate > 0
            ? `<small>${money(total * settings.exchangeRate)} ليرة سورية</small>`
            : ''}`).join('')
        : '—'
      fitInvoiceSummaryText(netElement, 12, 6)
    }
    const unitTotals = invoicePanel.querySelector<HTMLUListElement>('[data-invoice-unit-totals]')
    if (unitTotals) {
      const displayedQuantities = aggregateInvoiceQuantities(invoiceItems
        .filter((item) => !item.cancelled)
        .map((item) => ({
          unit: item.unit,
          quantity: item.quantity.trim() ? Number(item.quantity) : Number.NaN,
          amount: item.quantity.trim() && item.price.trim()
            ? Number(item.quantity) * Number(item.price)
            : null,
        })))
      unitTotals.innerHTML = displayedQuantities.map(({ unit, quantity, amount }) =>
        `<li>${invoiceQuantity(quantity)} ${escapeHtml(unit)} = ${amount === null ? 'قيمة غير مكتملة' : `${money(amount)} دولار`}</li>`).join('')
      fitInvoiceSummaryText(unitTotals, 12, 4)
    }
  }
  const collectInvoiceExportData = (): InvoiceExportData | null => {
    if (!invoiceItems.length) {
      showToast('أضف خدمة واحدة على الأقل قبل تصدير الفاتورة.')
      return null
    }
    const rows: InvoiceExportRow[] = []
    const activeRows: InvoiceExportRow[] = []
    let invoiceTotal = 0
    for (const item of invoiceItems) {
      const name = item.name.trim()
      const unit = item.unit.trim()
      const notes = item.notes.trim()
      const quantityText = item.quantity.trim()
      const priceText = item.price.trim()
      if (item.cancelled) {
        const quantity = Number.isFinite(Number(quantityText)) ? Number(quantityText) : 0
        const unitPrice = Number.isFinite(Number(priceText)) ? Number(priceText) : 0
        rows.push({ name, notes, quantity, unit, unitPrice, total: 0, cancelled: true })
        continue
      }
      if (!name || !unit) {
        showToast('أكمل اسم الخدمة ووحدة القياس في جميع البطاقات غير المُلغاة.')
        return null
      }
      if (!quantityText || !priceText) {
        showToast('أكمل الكمية وسعر الوحدة في جميع البطاقات غير المُلغاة.')
        return null
      }
      const quantity = Number(quantityText)
      const unitPrice = Number(priceText)
      if (!Number.isFinite(quantity) || quantity < 0 || !Number.isFinite(unitPrice) || unitPrice < 0) {
        showToast('تحقق من إدخال كمية وسعر صحيحين غير سالبين.')
        return null
      }
      const lineTotal = quantity * unitPrice
      if (!Number.isFinite(lineTotal) || !Number.isFinite(invoiceTotal + lineTotal)) {
        showToast('إجمالي الفاتورة يتجاوز القيمة التي يمكن حسابها.')
        return null
      }
      const row: InvoiceExportRow = { name, notes, quantity, unit, unitPrice, total: lineTotal, cancelled: false }
      rows.push(row)
      activeRows.push(row)
      invoiceTotal += lineTotal
    }
    if (!activeRows.length) {
      showToast('لا يمكن حفظ/تصدير فاتورة بدون خدمات فعّالة. ألغِ حالة الإلغاء عن خدمة واحدة على الأقل.')
      return null
    }
    const now = new Date()
    const exportDate = formatInvoiceDateTime(now)
    return {
      rows,
      unitTotals: aggregateInvoiceQuantities(activeRows.map(({ unit, quantity, total }) => ({
        unit,
        quantity,
        amount: total,
      }))),
      total: invoiceTotal,
      invoiceNumber: '',
      discount: null,
      exportFormat: 'image-high',
      exportDate,
      customerId: null,
      customerName: '',
      customerPhone: '',
      customerAddress: '',
      responsibleTeacherName: '',
      upfrontPayment: null,
      upfrontPaymentDate: '',
      exportNote: '',
    }
  }
  const renderList = () => {
    const sorted = [...workServices].sort((a, b) => a.name.localeCompare(b.name, 'ar'))
    list.innerHTML = sorted.map((service) => {
      const checked = selected.has(service.id)
      const exportPrice = exportPrices.get(service.id) ?? service.price
      const isModified = modified.has(service.id) && exportPrice !== service.price
      const liraExportPrice = settings.syriaEnabled && settings.exchangeRate > 0
        ? service.currencyCode === 'USD'
          ? exportPrice * settings.exchangeRate
          : exportPrice
        : null
      const selectedOrder = checked
        ? [...selected].map((id) => sorted.findIndex((item) => item.id === id)).filter((position) => position >= 0).sort((a, b) => a - b).indexOf(sorted.findIndex((item) => item.id === service.id)) + 1
        : 0
      return `
        <article class="export-service-row ${checked ? 'is-selected' : ''}" data-export-row="${service.id}">
          ${checked ? `<span class="export-service-order" aria-label="الترتيب ${selectedOrder}">${selectedOrder}</span>` : ''}
          <button type="button" class="export-service-select" data-export-selected="${service.id}">
            <span>${escapeHtml(service.name)}</span>
            ${service.description ? `<span class="export-service-description">${escapeHtml(service.description)}</span>` : ''}
          </button>
          <div class="export-service-meta">
            <span>${escapeHtml(serviceUnitLabel(service.unit))}</span>
            <span class="export-meta-separator" aria-hidden="true">|</span>
            <span>السعر الأساسي: ${money(service.price)} ${service.currencyCode === 'USD' ? 'دولار' : escapeHtml(service.currencyCode)}</span>
          </div>
          <div class="export-price-field">
            <span>سعر التصدير بالدولار</span>
            <span class="export-price-stepper">
              <button type="button" class="export-price-adjust export-price-increase" data-export-adjust="increase" data-service-id="${service.id}" aria-label="زيادة السعر ربع دولار" ${checked ? '' : 'disabled'}>▲</button>
              <span class="export-price-input-wrap">
                <span class="export-price-dollar" aria-hidden="true">$</span>
                <input type="number" min="0" step="0.25" data-export-price="${service.id}" value="${exportPrice}" ${checked ? '' : 'disabled'}>
              </span>
              <button type="button" class="export-price-adjust export-price-decrease" data-export-adjust="decrease" data-service-id="${service.id}" aria-label="إنقاص السعر ربع دولار" ${checked ? '' : 'disabled'}>▼</button>
            </span>
            ${liraExportPrice !== null ? `<span class="export-syrian-price">${money(liraExportPrice)} ليرة</span>` : ''}
          </div>
          ${isModified ? '<span class="export-price-modified">معدّل</span>' : ''}
        </article>`
    }).join('')
    summary.innerHTML = `
      <div data-summary-modified><span>الأسعار المعدلة</span><strong>${modified.size}</strong></div>
      <div><span>إجمالي الخدمات</span><strong>${workServices.length}</strong></div>
      <div data-summary-selected><span>الخدمات المحددة</span><strong>${selected.size}</strong></div>`
    list.querySelectorAll<HTMLElement>('[data-export-row]').forEach((row) => {
      row.addEventListener('click', (event) => {
        const target = event.target as HTMLElement
        if (target.closest('[data-export-adjust], [data-export-price]')) return

        const id = row.dataset.exportRow!
        if (selected.has(id)) selected.delete(id)
        else selected.add(id)
        renderList()
      })
    })
    list.querySelectorAll<HTMLInputElement>('[data-export-price]').forEach((input) => {
      input.addEventListener('input', () => {
        const id = input.dataset.exportPrice!
        const service = workServices.find((item) => item.id === id)
        const value = Number(input.value)
        if (!service || !Number.isFinite(value) || value < 0) return
        exportPrices.set(id, value)
        if (value !== service.price) modified.add(id)
        else modified.delete(id)
        const syrianPrice = input.closest<HTMLElement>('.export-service-row')?.querySelector<HTMLElement>('.export-syrian-price')
        if (syrianPrice && settings.syriaEnabled && settings.exchangeRate > 0) {
          const liraValue = service.currencyCode === 'USD' ? value * settings.exchangeRate : value
          syrianPrice.textContent = `${money(liraValue)} ليرة`
        }
        summary.querySelector('[data-summary-modified] strong')!.textContent = String(modified.size)
        const row = input.closest<HTMLElement>('.export-service-row')
        const notice = row?.querySelector<HTMLElement>('.export-price-modified')
        if (notice) notice.remove()
        if (value !== service.price) {
          row?.insertAdjacentHTML('beforeend', '<span class="export-price-modified">معدّل</span>')
        }
      })
    })
    list.querySelectorAll<HTMLButtonElement>('[data-export-adjust]').forEach((button) => {
      button.addEventListener('click', (event) => {
        event.stopPropagation()
        const id = button.dataset.serviceId!
        const input = list.querySelector<HTMLInputElement>(`[data-export-price="${id}"]`)
        if (!input || input.disabled) return
        const current = Number(input.value)
        const base = Number.isFinite(current) ? current : 0
        const next = button.dataset.exportAdjust === 'increase'
          ? base + 0.25
          : Math.max(0, base - 0.25)
        input.value = String(next)
        input.dispatchEvent(new Event('input', { bubbles: true }))
      })
    })
  }
  renderList()
  invoicePanel.addEventListener('input', (event) => {
    if (event.target instanceof HTMLInputElement && event.target.matches('[data-invoice-search]')) {
      const query = event.target.value.trim().toLocaleLowerCase('ar')
      const options = [...invoicePanel.querySelectorAll<HTMLButtonElement>('.invoice-service-option')]
      let visibleOptions = 0
      options.forEach((option) => {
        const matches = option.textContent?.toLocaleLowerCase('ar').includes(query) ?? false
        option.hidden = !matches
        if (matches) visibleOptions += 1
      })
      const emptyState = invoicePanel.querySelector<HTMLElement>('.invoice-picker-empty')
      if (emptyState) emptyState.hidden = visibleOptions > 0
      return
    }
    if (!(event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement)) return
    const input = event.target
    const itemId = Number(
      input.dataset.invoiceQuantity ??
      input.dataset.invoicePrice ??
      input.dataset.invoiceName ??
      input.dataset.invoiceNotes ??
      input.dataset.invoiceUnit,
    )
    const item = invoiceItems.find((line) => line.id === itemId)
    if (!item) return
    if (input.matches('[data-invoice-quantity]')) {
      item.quantity = input.value
      updateInvoiceTotals()
    } else if (input.matches('[data-invoice-price]')) {
      item.price = input.value
      updateInvoiceTotals()
    } else if (input.matches('[data-invoice-name]')) {
      item.name = input.value
      updateInvoiceTotals()
    } else if (input.matches('[data-invoice-notes]')) {
      item.notes = input.value
    } else if (input.matches('[data-invoice-unit]')) {
      item.unit = input.value
      updateInvoiceTotals()
    }
  })
  invoicePanel.addEventListener('click', (event) => {
    if (!(event.target instanceof Element)) return
    const exportButton = event.target.closest<HTMLButtonElement>('[data-invoice-export]')
    if (exportButton) {
      if (exportDialogOpening) return
      const data = collectInvoiceExportData()
      if (data) {
        exportDialogOpening = true
        exportButton.disabled = true
        const ownerId = dataUserId
        const sourceRecord = options?.sourceRecord
        const savePayments = options?.savePayments ?? (sourceRecord ? sourceRecord.payments.map((payment) => ({ ...payment })) : undefined)
        if (sourceRecord) {
          data.customerName = sourceRecord.customerName
          data.customerPhone = sourceRecord.customerPhone
          data.customerAddress = sourceRecord.customerAddress
          data.responsibleTeacherName = sourceRecord.responsibleTeacherName
          data.discount = sourceRecord.discount ? { ...sourceRecord.discount } : null
          data.exportFormat = sourceRecord.exportFormat
        }
        if (savePayments && savePayments.length) {
          const lastPayment = savePayments[savePayments.length - 1]
          data.upfrontPayment = lastPayment.amount
          data.upfrontPaymentDate = lastPayment.date || data.exportDate
          data.payments = savePayments.map((payment) => ({ ...payment }))
        } else if (sourceRecord) {
          data.upfrontPayment = null
          data.upfrontPaymentDate = data.exportDate
          data.payments = []
        }
        const editableItems = invoiceItems.map(({ custom, name, notes, quantity, price, unit, unitCode, currencyCode, cancelled }) => ({
          custom,
          name,
          notes,
          quantity,
          price,
          unit,
          unitCode,
          currencyCode,
          cancelled: cancelled === true,
        }))
        if (sourceRecord) {
          const paidTotal = getInvoicePaidTotal(sourceRecord)
          const correctionNet = data.total - (sourceRecord.discount?.amount || 0)
          if (options?.correction && paidTotal - correctionNet > 0.00001) {
            showToast(`لا يمكن حفظ التصحيح لأن إجمالي الدفعات المسجلة (${money(paidTotal)} دولار) أكبر من صافي الفاتورة بعد التعديل (${money(Math.max(0, correctionNet))} دولار). عدّل البنود/الأسعار أو قلّل الدفعات أولًا.`)
            exportDialogOpening = false
            if (exportButton.isConnected) exportButton.disabled = false
            return
          }
          if (!element.isConnected || dataUserId !== ownerId) return
          data.invoiceNumber = sourceRecord.rootInvoiceNumber || sourceRecord.invoiceNumber
          openInvoiceCustomerExportDialog(data, ownerId, {
            sourceRecord,
            editableItems,
            payments: savePayments,
            mode: options?.correction ? 'save-correction' : 'export-save',
          })
          exportDialogOpening = false
          if (exportButton.isConnected) exportButton.disabled = false
        } else {
          void getInvoiceNumberCandidate(ownerId).then((invoiceNumber) => {
            if (!element.isConnected || dataUserId !== ownerId) return
            data.invoiceNumber = invoiceNumber
            openInvoiceCustomerExportDialog(data, ownerId, { sourceRecord, editableItems, payments: savePayments, mode: 'export-save' })
          }).catch((error: unknown) => {
            console.error('Failed to prepare invoice export:', error)
            showToast('تعذر تجهيز رقم الفاتورة. حاول مجددًا.')
          }).finally(() => {
            exportDialogOpening = false
            if (exportButton.isConnected) exportButton.disabled = false
          })
        }
      }
      return
    }
    const cancelButton = event.target.closest<HTMLButtonElement>('[data-invoice-cancel]')
    if (cancelButton) {
      const itemId = Number(cancelButton.dataset.invoiceCancel)
      const item = invoiceItems.find((line) => line.id === itemId)
      if (!item) return
      item.cancelled = !item.cancelled
      renderInvoice()
      return
    }
    if (event.target.closest('[data-invoice-custom]')) {
      const itemId = nextInvoiceItemId++
      invoiceItems.push({
        id: itemId,
        custom: true,
        name: '',
        notes: '',
        quantity: '',
        price: '',
        unit: '',
        unitCode: null,
        currencyCode: 'USD',
        cancelled: false,
      })
      renderInvoice()
      return
    }
    const serviceOption = event.target.closest<HTMLButtonElement>('[data-invoice-choice]')
    if (serviceOption) {
      const service = workServices.find((item) => item.id === serviceOption.dataset.invoiceChoice)
      if (!service) return
      const usdPrice = invoicePriceInUsd(service)
      if (usdPrice === null) {
        showToast('أدخل سعر الصرف لتحويل سعر الخدمة إلى الدولار.')
        return
      }
      const itemId = nextInvoiceItemId++
      invoiceItems.push({
        id: itemId,
        custom: false,
        name: service.name,
        notes: '',
        quantity: '',
        price: String(usdPrice),
        unit: serviceUnitLabel(service.unit),
        unitCode: service.unit,
        currencyCode: 'USD',
        cancelled: false,
      })
      renderInvoice()
      return
    }
    const trigger = event.target.closest<HTMLButtonElement>('[data-invoice-picker-trigger]')
    if (trigger) {
      const picker = trigger.closest<HTMLElement>('.invoice-service-picker')
      const menu = picker?.querySelector<HTMLElement>('.invoice-service-picker-menu')
      if (!picker || !menu) return
      menu.hidden = !menu.hidden
      picker.classList.toggle('is-open', !menu.hidden)
      trigger.setAttribute('aria-expanded', String(!menu.hidden))
      return
    }
    const picker = event.target.closest<HTMLElement>('.invoice-service-picker')
    if (!picker) {
      invoicePanel.querySelectorAll<HTMLElement>('.invoice-service-picker.is-open').forEach((openPicker) => {
        openPicker.classList.remove('is-open')
        openPicker.querySelector<HTMLElement>('.invoice-service-picker-menu')!.hidden = true
        openPicker.querySelector<HTMLButtonElement>('[data-invoice-picker-trigger]')!.setAttribute('aria-expanded', 'false')
      })
    }
  })
  invoicePanel.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return
    const picker = invoicePanel.querySelector<HTMLElement>('.invoice-service-picker.is-open')
    if (!picker) return
    picker.classList.remove('is-open')
    picker.querySelector<HTMLElement>('.invoice-service-picker-menu')!.hidden = true
    const trigger = picker.querySelector<HTMLButtonElement>('[data-invoice-picker-trigger]')!
    trigger.setAttribute('aria-expanded', 'false')
    trigger.focus()
  })
  element.querySelectorAll<HTMLButtonElement>('[data-export-tab]').forEach((tab) => {
    tab.addEventListener('click', () => {
      element.querySelectorAll<HTMLButtonElement>('[data-export-tab]').forEach((item) =>
        item.classList.toggle('active', item === tab))
      const servicesPanel = element.querySelector<HTMLElement>('#export-services-panel')!
      const showServices = tab.dataset.exportTab === 'services'
      servicesPanel.hidden = !showServices
      servicesPanel.classList.toggle('hidden', !showServices)
      const showInvoice = tab.dataset.exportTab === 'invoice'
      invoicePanel.hidden = !showInvoice
      invoicePanel.classList.toggle('hidden', !showInvoice)
      if (showInvoice) renderInvoice()
    })
  })
  renderInvoice()
  const getRows = (): ExportServiceRow[] => [...workServices]
    .filter((service) => selected.has(service.id))
    .sort((a, b) => a.name.localeCompare(b.name, 'ar'))
    .map((service) => ({
      service,
      exportPrice: exportPrices.get(service.id) ?? service.price,
      wasModified: modified.has(service.id),
    }))
  element.querySelector('#export-excel')!.addEventListener('click', (event) =>
    exportServicesToExcel(event.currentTarget as HTMLButtonElement, getRows()))
  element.querySelector('#export-png')!.addEventListener('click', () =>
    openImageExportPreview(1, getRows()))
  element.querySelector('#export-png-high')!.addEventListener('click', () =>
    openImageExportPreview(2, getRows()))
}

async function loadSettings(user: User, ownerId: string, sessionId: number) {
  settings = loadCachedSettings(ownerId)
  try {
    const snapshot = await getDoc(doc(db, 'users', ownerId))
    const loaded = snapshot.exists() ? safeSettings(snapshot.data()) : defaultSettings
    saveCachedSettings(ownerId, loaded)
    if (currentUser?.uid === user.uid && dataUserId === ownerId && authSessionId === sessionId) {
      settings = loaded
    }
  } catch {
    /* Keep the local settings cache. */
  }
}

async function startAuth() {
  applyTheme(true)
  renderBootstrap()
  try {
    await setPersistence(auth, browserLocalPersistence)
  } catch {
    /* Firebase can still report the current auth state. */
  }
  onAuthStateChanged(auth, async (user) => {
    const ownerId = user ? resolveDataUserId(user) : ''
    if (currentUser?.uid !== user?.uid || dataUserId !== ownerId) authSessionId += 1
    currentUser = user
    dataUserId = ownerId
    const sessionId = authSessionId
    unsubscribeServices()
    unsubscribeCustomers()
    unsubscribeInvoices()
    unsubscribeServices = () => undefined
    unsubscribeCustomers = () => undefined
    unsubscribeInvoices = () => undefined
    workServices = []
    customers = []
    invoiceRecords = []
    activeMainSection = 'services'
    if (!user) {
      settings = defaultSettings
      applyTheme(true)
      renderAuth()
      return
    }
    await loadSettings(user, ownerId, sessionId)
    if (currentUser?.uid !== user.uid || dataUserId !== ownerId || authSessionId !== sessionId) return
    renderProductsShell()
    const servicesQuery = query(collection(db, 'users', ownerId, 'services'))
    unsubscribeServices = onSnapshot(servicesQuery, (snapshot) => {
      workServices = snapshot.docs
        .map((item) => parseWorkService(item.id, item.data()))
        .filter((item): item is WorkService => item !== null)
        .sort((a, b) => a.name.localeCompare(b.name, 'ar'))
      updateServicesShell()
    }, (error) => {
      console.error('Failed to load services:', error)
      showToast(`تعذر تحميل الخدمات: ${friendlyError(error)}`)
    })
    const customersQuery = query(collection(db, 'users', ownerId, 'customers'))
    unsubscribeCustomers = onSnapshot(customersQuery, (snapshot) => {
      customers = snapshot.docs
        .map((item) => parseCustomer(item.id, item.data()))
        .filter((item): item is Customer => item !== null)
        .sort((a, b) => a.name.localeCompare(b.name, 'ar'))
      if (activeMainSection === 'customers') renderCustomersSection()
    }, (error) => {
      console.error('Failed to load customers:', error)
      showToast(`تعذر تحميل الزبائن: ${friendlyError(error)}`)
    })
    const invoicesQuery = query(collection(db, 'users', ownerId, 'invoices'))
    unsubscribeInvoices = onSnapshot(invoicesQuery, (snapshot) => {
      invoiceRecords = snapshot.docs
        .map((item) => parseInvoiceRecord(item.id, item.data()))
        .filter((item): item is InvoiceRecord => item !== null)
      if (activeMainSection === 'invoices') renderInvoicesSection()
    }, (error) => {
      console.error('Failed to load invoices:', error)
      showToast(`تعذر تحميل الفواتير: ${friendlyError(error)}`)
    })
  })
}

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    if (import.meta.env.DEV) {
      void navigator.serviceWorker.getRegistration(new URL(import.meta.env.BASE_URL, window.location.href).href)
        .then((registration) => registration?.unregister())
        .catch((error) => console.error('Failed to disable the service worker in development:', error))
      return
    }
    void navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`, {
      scope: import.meta.env.BASE_URL,
    }).catch((error) => console.error('Failed to register the service worker:', error))
  })
}

startAuth()
