import './style.css'
import { initializeApp } from 'firebase/app'
import {
  EmailAuthProvider,
  browserLocalPersistence,
  createUserWithEmailAndPassword,
  getAuth,
  onAuthStateChanged,
  reauthenticateWithCredential,
  setPersistence,
  signInWithEmailAndPassword,
  signOut,
  updatePassword,
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
import { normalizeMeasurementUnits, systemMeasurementUnits, type MeasurementUnit } from './measurement-units'
import { openUsagePolicyDialog } from './privacy-policy'

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

type ServiceUnit = string

type AppSettings = {
  syriaEnabled: boolean
  exchangeRate: number
  darkMode: boolean
  localCurrencyCode: string
  localCurrencyName: string
  companyProfile: CompanyProfile
  measurementUnits: MeasurementUnit[]
}

type CompanyContact = {
  name: string
  phone: string
}

type CompanyProfile = {
  name: string
  offerings: string
  details: string
  address: string
  contacts: CompanyContact[]
}

type AccountProfile = {
  name: string
  phone: string
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
  neighborhood: string
  notes: string
  archived: boolean
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
}

type InvoiceUnitTotal = {
  unit: string
  quantity: number
  amount: number | null
}

type InvoiceExportFormat = 'image' | 'image-high'
const highQualityImageScale = 3
type ImageExportScale = 1 | typeof highQualityImageScale

type StoredInvoiceDiscount = {
  mode: 'percentage' | 'amount'
  value: number
  amount: number
} | null

type StoredInvoiceEditableItem = {
  id?: number
  custom: boolean
  name: string
  notes: string
  quantity: string
  price: string
  unit: string
  unitCode: ServiceUnit | null
  currencyCode: string
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
  workshopName: string
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
  companyProfile: { name: '', offerings: '', details: '', address: '', contacts: [] },
  measurementUnits: systemMeasurementUnits,
}

let currentUser: User | null = null
let dataUserId = ''
let authSessionId = 0
let accountProfile: AccountProfile = { name: '', phone: '' }
let accountProfileReady = false
let settings: AppSettings = defaultSettings
let activeMainSection: MainSection = 'services'
let workServices: WorkService[] = []
let customers: Customer[] = []
let invoiceRecords: InvoiceRecord[] = []
let customerListView: 'active' | 'archived' = 'active'
let invoicesLoaded = false
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
export const USD_CURRENCY_SYMBOL = '$'
export const formatUsdAmount = (value: number) => `${money(value)} ${USD_CURRENCY_SYMBOL}`
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
    companyProfile: safeCompanyProfile(data.companyProfile),
    measurementUnits: normalizeMeasurementUnits(data.measurementUnits),
  }
}

function safeCompanyProfile(value: unknown): CompanyProfile {
  const data = typeof value === 'object' && value !== null
    ? value as Partial<CompanyProfile>
    : {}
  const text = (value: unknown, maxLength: number) =>
    typeof value === 'string' ? value.slice(0, maxLength) : ''
  const contacts = Array.isArray(data.contacts)
    ? data.contacts.flatMap((contact) => {
      if (typeof contact !== 'object' || contact === null || Array.isArray(contact)) return []
      const item = contact as Partial<CompanyContact>
      const name = text(item.name, 60)
      const phone = text(item.phone, 30)
      return name.trim() || phone.trim() ? [{ name, phone }] : []
    }).slice(0, 3)
    : []
  return {
    name: text(data.name, 100),
    offerings: text(data.offerings, 300),
    details: text(data.details, 500),
    address: text(data.address, 200),
    contacts,
  }
}

function accountProfileForUser(user: User, value: unknown): AccountProfile {
  const data = typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
  const legacyName = [data.firstName, data.lastName]
    .filter((part): part is string => typeof part === 'string')
    .map((part) => part.trim())
    .filter(Boolean)
    .join(' ')
  const savedName = typeof data.name === 'string' ? data.name.trim() : ''
  const savedPhone = typeof data.phone === 'string' ? data.phone.trim() : ''
  return {
    name: (savedName || legacyName || user.displayName?.trim() || '').slice(0, 60),
    phone: (savedPhone || user.phoneNumber?.trim() || '').slice(0, 30),
  }
}

function currentCompanyBranding() {
  if (!currentUser) return { name: '', offerings: '', contactLine: '', contactDetails: '' }
  const company = safeCompanyProfile(settings.companyProfile)
  const phones = company.contacts
    .map((contact) => contact.phone.trim())
    .filter(Boolean)
  const contactDetails = company.contacts
    .map((contact) => [contact.name.trim(), contact.phone.trim()].filter(Boolean).join(' '))
    .filter(Boolean)
  return {
    name: company.name.trim(),
    offerings: company.offerings.trim(),
    contactLine: phones.length ? `للتواصل: ${phones.join('  -  ')}` : '',
    contactDetails: contactDetails.join('  -  '),
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
  const unit = typeof data.unit === 'string' && data.unit.trim() ? data.unit.trim() : null
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
    neighborhood: typeof data.neighborhood === 'string' ? data.neighborhood.trim() : '',
    notes: typeof data.notes === 'string' ? data.notes.trim() : '',
    archived: data.archived === true,
    createdAt: typeof data.createdAt === 'string' ? data.createdAt : '',
    updatedAt: typeof data.updatedAt === 'string' ? data.updatedAt : '',
  }
}

type CustomerIdentityMatch =
  | { kind: 'exact'; customer: Customer }
  | { kind: 'duplicate-identity'; customer: Customer }
  | { kind: 'phone-conflict'; customer: Customer }
  | { kind: 'duplicate-identity-multiple'; name: string }
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
  neighborhood: string,
  excludeCustomerId?: string,
): CustomerIdentityMatch | null {
  const nameKey = normalizeCustomerText(name)
  const phoneKey = normalizeCustomerPhone(phone)
  const addressKey = normalizeCustomerText(address)
  const neighborhoodKey = normalizeCustomerText(neighborhood)
  const candidates = customers.filter((customer) => customer.id !== excludeCustomerId)
  const sameName = nameKey
    ? candidates.filter((customer) => normalizeCustomerText(customer.name) === nameKey)
    : []
  const phoneMatches = phoneKey
    ? candidates.filter((customer) => normalizeCustomerPhone(customer.phone) === phoneKey)
    : []

  if (phoneMatches.length) {
    const exactMatches = phoneMatches.filter((customer) =>
      !nameKey || normalizeCustomerText(customer.name) === nameKey)
    if (exactMatches.length === 1) return { kind: 'exact', customer: exactMatches[0] }
    if (exactMatches.length > 1 || (!nameKey && phoneMatches.length > 1)) return { kind: 'multiple-matches' }
    return { kind: 'phone-conflict', customer: phoneMatches[0] }
  }

  if (!nameKey) return null
  const exactIdentityMatches = sameName.filter((customer) =>
    (!phoneKey || normalizeCustomerPhone(customer.phone) === phoneKey)
    && (!addressKey || normalizeCustomerText(customer.address) === addressKey)
    && (!neighborhoodKey || normalizeCustomerText(customer.neighborhood) === neighborhoodKey))
  if (exactIdentityMatches.length > 1) {
    return { kind: 'duplicate-identity-multiple', name: sameName[0].name }
  }
  if (exactIdentityMatches.length === 1) {
    return { kind: 'duplicate-identity', customer: exactIdentityMatches[0] }
  }
  return null
}

function customerIdentityMessage(match: CustomerIdentityMatch, context: 'invoice' | 'customer') {
  if ('customer' in match && match.customer.archived) {
    return context === 'invoice'
      ? `الزبون ${match.customer.name} مؤرشف. استعده من تبويب الأرشيف قبل ربط فاتورة جديدة به.`
      : `الزبون ${match.customer.name} مؤرشف. استعده من تبويب الأرشيف قبل تعديل بياناته أو استخدامه.`
  }
  if (match.kind === 'exact') {
    return context === 'invoice'
      ? 'تطابق رقم الهاتف أو بيانات الزبون مع سجل موجود. لا يمكن حفظ الفاتورة بهذه البيانات؛ اختر الزبون المسجل من السهم داخل خانة الاسم.'
      : `رقم الهاتف مسجل بالفعل للزبون ${match.customer.name}. لا يمكن استخدامه لزبون آخر؛ تحقق من الرقم.`
  }
  if (match.kind === 'duplicate-identity') {
    return context === 'invoice'
      ? `اسم الزبون ${match.customer.name} مسجل بالفعل. أدخل رقم هاتف أو عنوانًا أو حيًا مختلفًا، أو اختر الزبون المسجل من السهم.`
      : `اسم الزبون ${match.customer.name} مسجل بالفعل. لا يمكن الحفظ حتى تُدخل رقم هاتف أو عنوانًا أو حيًا يختلف عن بياناته.`
  }
  if (match.kind === 'phone-conflict') {
    return context === 'invoice'
      ? `رقم الهاتف مرتبط بزبون اسمه ${match.customer.name}. لا يمكن حفظ الفاتورة بهذا الرقم؛ صحح الرقم أو اختر هذا الزبون من السهم داخل خانة الاسم.`
      : `رقم الهاتف مرتبط بزبون اسمه ${match.customer.name}. لا يمكن إضافة زبون آخر بهذا الرقم.`
  }
  if (match.kind === 'duplicate-identity-multiple') {
    return context === 'invoice'
      ? `توجد عدة سجلات مطابقة لاسم ${match.name} وبياناته. اختر الزبون الصحيح من السهم أو غيّر رقم الهاتف أو العنوان أو الحي.`
      : `توجد عدة سجلات مطابقة لاسم ${match.name} وبياناته. غيّر رقم الهاتف أو العنوان أو الحي.`
  }
  return context === 'invoice'
    ? 'توجد عدة سجلات محتملة لهذا الاسم أو الرقم. لا يمكن حفظ الفاتورة؛ اختر الزبون الصحيح من السهم داخل خانة الاسم أو عدّل الاسم.'
    : 'توجد عدة سجلات محتملة لهذه البيانات. تحقق منها قبل إضافة الزبون.'
}

function normalizeInvoiceNumber(value: string): string {
  const trimmed = value.trim()
  return /^\d+$/.test(trimmed) ? trimmed.replace(/^0+(?=\d)/, '') : trimmed
}

function parseInvoiceRecord(id: string, data: Record<string, unknown>): InvoiceRecord | null {
  const invoiceNumber = typeof data.invoiceNumber === 'string' ? normalizeInvoiceNumber(data.invoiceNumber) : ''
  if (!invoiceNumber) return null
  const rootId = typeof data.rootId === 'string' && data.rootId.trim() ? data.rootId.trim() : id
  const rootInvoiceNumber = typeof data.rootInvoiceNumber === 'string' && data.rootInvoiceNumber.trim()
    ? normalizeInvoiceNumber(data.rootInvoiceNumber)
    : invoiceNumber
  // Ignore entries from the former soft-cancel flow so they cannot reappear in edits or exports.
  const rows = Array.isArray(data.rows) ? data.rows.filter((row) =>
    !(row && typeof row === 'object' && (row as Record<string, unknown>).cancelled === true),
  ).map((row) => {
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
  const items: StoredInvoiceEditableItem[] = Array.isArray(data.items) ? data.items.filter((entry) =>
    !(entry && typeof entry === 'object' && (entry as Record<string, unknown>).cancelled === true),
  ).map((entry) => {
    const item = entry && typeof entry === 'object' ? entry as Record<string, unknown> : {}
    const unitCode: ServiceUnit | null = typeof item.unitCode === 'string' && item.unitCode.trim()
      ? item.unitCode
      : null
    return {
      ...(typeof item.id === 'number' && Number.isSafeInteger(item.id) && item.id > 0 ? { id: item.id } : {}),
      custom: item.custom === true,
      name: typeof item.name === 'string' ? item.name : '',
      notes: typeof item.notes === 'string' ? item.notes : '',
      quantity: typeof item.quantity === 'string' ? item.quantity : (typeof item.quantity === 'number' ? String(item.quantity) : ''),
      price: typeof item.price === 'string' ? item.price : (typeof item.price === 'number' ? String(item.price) : ''),
      unit: typeof item.unit === 'string' ? item.unit : '',
      unitCode,
      currencyCode: typeof item.currencyCode === 'string' && item.currencyCode.trim() ? item.currencyCode.trim() : 'USD',
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
    exportFormat: data.exportFormat === 'image' ? 'image' : 'image-high',
    exportDate: typeof data.exportDate === 'string' ? data.exportDate : '',
    customerId: typeof data.customerId === 'string' && data.customerId.trim() ? data.customerId.trim() : null,
    customerName: typeof data.customerName === 'string' ? data.customerName : '',
    customerPhone: typeof data.customerPhone === 'string' ? data.customerPhone : '',
    customerAddress: typeof data.customerAddress === 'string' ? data.customerAddress : '',
    workshopName: typeof data.workshopName === 'string' ? data.workshopName : '',
    responsibleTeacherName: typeof data.responsibleTeacherName === 'string' ? data.responsibleTeacherName : '',
    payments,
    savedAt: typeof data.savedAt === 'string' ? data.savedAt : '',
    createdAt: typeof data.createdAt === 'string' ? data.createdAt : '',
    updatedAt: typeof data.updatedAt === 'string' ? data.updatedAt : '',
  }
}

function serviceUnitLabel(unit: ServiceUnit): string {
  const registeredUnit = settings.measurementUnits.find((item) => item.id === unit)
  if (registeredUnit) return registeredUnit.name
  const legacyLabels: Record<string, string> = {
    PCS: 'قطعة / عدد',
    PROJECT: 'مشروع',
    GROUP: 'مجموعة',
  }
  return legacyLabels[unit] || 'وحدة غير مسجلة'
}

function modal(content: string, options: { preserveExisting?: boolean } = {}) {
  if (!options.preserveExisting) {
    document.querySelectorAll<HTMLDivElement>('.modal-backdrop').forEach((element) => element.remove())
  }
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

function attachPasswordToggle(button: HTMLButtonElement) {
  const targets = button.dataset.targets
    ? button.dataset.targets.split(',')
    : button.dataset.target
      ? [button.dataset.target]
      : []
  const inputs = targets
    .map((name) => document.querySelector<HTMLInputElement>(`input[name="${name.trim()}"]`))
    .filter((input): input is HTMLInputElement => Boolean(input))
  if (!inputs.length) return
  button.addEventListener('click', () => {
    const shouldShow = inputs.some((input) => input.type === 'password')
    inputs.forEach((input) => { input.type = shouldShow ? 'text' : 'password' })
    button.textContent = shouldShow ? 'إخفاء كلمة المرور' : 'إظهار كلمة المرور'
    button.setAttribute('aria-label', shouldShow ? 'إخفاء كلمة المرور' : 'إظهار كلمة المرور')
    button.setAttribute('aria-pressed', String(shouldShow))
  })
}

function renderAuth(
  error = '',
  signUp = false,
  initial: { name?: string; phone?: string; email?: string } = {},
) {
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
        ${signUp ? `<label>الاسم أو اللقب<input name="name" maxlength="60" autocomplete="name" value="${escapeHtml(initial.name || '')}" required></label>
        <label>رقم الهاتف<input name="phone" type="tel" inputmode="tel" maxlength="30" autocomplete="tel" value="${escapeHtml(initial.phone || '')}" required></label>` : ''}
        <label>البريد الإلكتروني<input name="email" type="email" autocomplete="email" value="${escapeHtml(initial.email || '')}" placeholder="name@example.com" required></label>
        ${signUp ? `
          <label class="auth-field">
            <div class="field-header-row">
              <span class="field-label">كلمة المرور</span>
              <button class="password-visibility-toggle" type="button" data-targets="password,confirmPassword" aria-label="إظهار كلمة المرور" aria-pressed="false">إظهار كلمة المرور</button>
            </div>
            <input name="password" type="password" autocomplete="new-password" minlength="6" placeholder="••••••••" required>
          </label>
          <label class="auth-field">
            <span class="field-label">تأكيد كلمة المرور</span>
            <input name="confirmPassword" type="password" autocomplete="new-password" minlength="6" placeholder="••••••••" required>
          </label>` : `
          <label class="auth-field">
            <div class="field-header-row">
              <span class="field-label">كلمة المرور</span>
              <button class="password-visibility-toggle" type="button" data-target="password" aria-label="إظهار كلمة المرور" aria-pressed="false">إظهار كلمة المرور</button>
            </div>
            <input name="password" type="password" autocomplete="current-password" minlength="6" placeholder="••••••••" required>
          </label>`}
        ${signUp ? `
          <div class="auth-policy-consent">
            <input id="signup-policy-accepted" name="policyAccepted" type="checkbox" required>
            <label for="signup-policy-accepted">أوافق على</label>
            <button class="auth-policy-link" id="auth-policy-link" type="button">سياسة الاستخدام</button>
          </div>` : `
          <div class="auth-policy-login">
            <span>للاطلاع على</span>
            <button class="auth-policy-link" id="auth-policy-link" type="button">سياسة الاستخدام</button>
          </div>`}
        <p class="form-error">${escapeHtml(error)}</p>
        <button class="primary-button" type="submit">${signUp ? 'إنشاء الحساب' : 'تسجيل الدخول'}</button>
        <button class="text-button" type="button" id="toggle-auth">${signUp ? 'لديك حساب؟ تسجيل الدخول' : 'إنشاء حساب جديد'}</button>
      </form>
    </main>`
  const policyLink = document.querySelector<HTMLButtonElement>('#auth-policy-link')!
  policyLink.addEventListener('click', () => openUsagePolicyDialog(policyLink))
  document.querySelectorAll<HTMLButtonElement>('.password-visibility-toggle').forEach(attachPasswordToggle)
  document.querySelector('#toggle-auth')!.addEventListener('click', () => renderAuth('', !signUp))
  document.querySelector<HTMLFormElement>('#auth-form')!.addEventListener('submit', async (event) => {
    event.preventDefault()
    const authForm = event.currentTarget as HTMLFormElement
    const form = new FormData(authForm)
    if (signUp && authForm.querySelector<HTMLInputElement>('#signup-policy-accepted')?.checked !== true) {
      authForm.querySelector<HTMLElement>('.form-error')!.textContent = 'يجب الموافقة على سياسة الاستخدام لإنشاء الحساب.'
      return
    }
    const email = String(form.get('email')).trim()
    const password = String(form.get('password'))
    const name = String(form.get('name') || '').trim()
    const phone = String(form.get('phone') || '').trim()
    const submit = document.querySelector<HTMLButtonElement>('#auth-form button[type="submit"]')!
    submit.disabled = true
    try {
      if (signUp) {
        if (!name || !phone) {
          renderAuth('أدخل الاسم أو اللقب ورقم الهاتف لإكمال إنشاء الحساب.', true, { name, phone, email })
          return
        }
        if (password !== String(form.get('confirmPassword'))) {
          renderAuth('كلمتا المرور غير متطابقتين', true, { name, phone, email })
          return
        }
        const credential = await createUserWithEmailAndPassword(auth, email, password)
        if (currentUser?.uid === credential.user.uid) {
          accountProfile = { name, phone }
          accountProfileReady = true
        }
        try {
          await setDoc(
            doc(db, 'users', resolveDataUserId(credential.user), 'accountProfiles', credential.user.uid),
            { name, phone },
            { merge: true },
          )
        } catch (profileError) {
          console.error('Account created, but the signup profile could not be saved.', profileError)
          showToast('تم إنشاء الحساب، لكن تعذر حفظ الاسم ورقم الهاتف. يمكنك حفظهما من إعدادات الحساب.')
        }
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
          : 'تعذر تسجيل الدخول أو إنشاء الحساب.', signUp, { name, phone, email })
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
              <span class="service-price-label">السعر</span>
              <strong class="service-price">${Number.isFinite(dollarPrice) ? formatUsdAmount(dollarPrice) : 'غير متاح'}</strong>
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

function getCustomerInvoiceSummaries() {
  const summaries = new Map<string, { total: number; paid: number; remaining: number }>()
  const roots = invoiceRecords.filter((record) => record.rootId === record.id)

  roots.forEach((root) => {
    const versions = getInvoiceRootVersions(root.rootId)
    const latest = versions[versions.length - 1] || root
    const linkedCustomer = customers.find((customer) => customer.id === latest.customerId)
    const nameKey = normalizeCustomerText(latest.customerName)
    const matchingCustomers = nameKey
      ? customers.filter((customer) => normalizeCustomerText(customer.name) === nameKey)
      : []
    const phoneKey = normalizeCustomerPhone(latest.customerPhone)
    const matchedCustomer = linkedCustomer
      || (phoneKey
        ? matchingCustomers.find((customer) => normalizeCustomerPhone(customer.phone) === phoneKey)
        : undefined)
      || (matchingCustomers.length === 1 ? matchingCustomers[0] : undefined)
    if (!matchedCustomer) return

    const summary = summaries.get(matchedCustomer.id) || { total: 0, paid: 0, remaining: 0 }
    summary.total += getInvoiceNetTotal(latest)
    summary.paid += getInvoicePaidTotal(latest)
    summary.remaining += getInvoiceRemainingTotal(latest)
    summaries.set(matchedCustomer.id, summary)
  })

  return summaries
}

function renderCustomersSection() {
  const content = document.querySelector<HTMLElement>('#main-section-content')
  const count = document.querySelector<HTMLElement>('#service-count')
  if (!content) return
  const invoiceSummaries = getCustomerInvoiceSummaries()
  const search = getMainSearchQuery()
  const activeCount = customers.filter((customer) => !customer.archived).length
  const archivedCount = customers.filter((customer) => customer.archived).length
  const matchingView = customers.filter((customer) => customer.archived === (customerListView === 'archived'))
  const visible = matchingView
    .filter((customer) => [customer.name, customer.phone, customer.address, customer.neighborhood, customer.notes].join(' ').toLocaleLowerCase('ar').includes(search))
    .sort((a, b) => a.name.localeCompare(b.name, 'ar'))
  if (count) count.textContent = String(visible.length)
  content.innerHTML = `
    <div class="customer-view-switcher" role="tablist" aria-label="قائمة الزبائن">
      <button type="button" role="tab" data-customer-view="active" aria-selected="${customerListView === 'active'}" class="${customerListView === 'active' ? 'active' : ''}">النشطون <span>${activeCount}</span></button>
      <button type="button" role="tab" data-customer-view="archived" aria-selected="${customerListView === 'archived'}" class="${customerListView === 'archived' ? 'active' : ''}">الأرشيف <span>${archivedCount}</span></button>
    </div>
    ${visible.length ? `
    <section class="service-list customers-list">
      ${visible.map((customer, index) => {
        const summary = invoiceSummaries.get(customer.id) || { total: 0, paid: 0, remaining: 0 }
        const paymentStatus = summary.total <= 0.00001
          ? null
          : summary.remaining <= 0.00001
            ? { key: 'paid', label: 'مسدد بالكامل' }
            : summary.paid > 0.00001
              ? { key: 'partial', label: 'مسدد جزئيًا' }
              : { key: 'unpaid', label: 'غير مسدد' }
        return `
          <article class="service-row customer-row">
            ${paymentStatus ? `<span class="invoice-status-badge is-${paymentStatus.key}" aria-label="حالة الفواتير: ${paymentStatus.label}">${paymentStatus.label}</span>` : ''}
            <button class="customer-account-button" type="button" data-account-customer="${customer.id}" aria-label="فتح كشف حساب ${escapeHtml(customer.name)}">كشف حساب</button>
            <span class="service-order" aria-label="رقم الزبون ${index + 1}">${index + 1}</span>
            <button class="service-main customer-main" type="button" data-edit-customer="${customer.id}">
              <span class="customer-identity-line">
                <span class="customer-title-line">
                  <span class="service-name customer-identity-name">${escapeHtml(customer.name)}</span>
                  ${customer.archived ? '<span class="customer-archived-badge">مؤرشف</span>' : ''}
                </span>
                <span class="customer-address-line">
                  <span class="customer-address">${customer.address ? escapeHtml(customer.address) : 'بدون عنوان'}</span>
                  ${customer.neighborhood ? `<span class="customer-identity-separator" aria-hidden="true">|</span><span class="customer-neighborhood">${escapeHtml(customer.neighborhood)}</span>` : ''}
                </span>
              </span>
              ${customer.phone ? `<span class="customer-phone">${escapeHtml(customer.phone)}</span>` : ''}
              ${customer.notes ? `<span class="service-description customer-notes">${escapeHtml(customer.notes)}</span>` : ''}
              <span class="customer-financials" aria-label="الملخص المالي للزبون">
                <span class="customer-financial-card customer-financial-card--total">
                  <span class="customer-financial-label">الإجمالي</span>
                  <strong>${formatUsdAmount(summary.total)}</strong>
                </span>
                <span class="customer-financial-card customer-financial-card--paid">
                  <span class="customer-financial-label">المسدد</span>
                  <strong>${formatUsdAmount(summary.paid)}</strong>
                </span>
                <span class="customer-financial-card customer-financial-card--remaining ${summary.remaining <= 0.00001 ? 'is-clear' : 'is-due'}">
                  <span class="customer-financial-label">الباقي</span>
                  <strong>${formatUsdAmount(summary.remaining)}</strong>
                </span>
              </span>
            </button>
          </article>
        `
      }).join('')}
    </section>
    ` : `<div class="empty-state"><div class="empty-icon">⌕</div><h2>${matchingView.length ? 'لا توجد نتائج' : customerListView === 'archived' ? 'لا يوجد زبائن في الأرشيف' : customers.length ? 'لا يوجد زبائن نشطون' : 'ابدأ بإضافة أول زبون'}</h2><p>${matchingView.length ? 'جرّب كلمة بحث مختلفة.' : customerListView === 'archived' ? 'ستظهر هنا الزبائن الذين أرشفتهم، ويمكنك استعادتها في أي وقت.' : customers.length ? 'يمكنك استعادة زبون من الأرشيف أو إضافة زبون جديد.' : 'أضف اسم الزبون ورقم الهاتف والعنوان والملاحظات.'}</p></div>`}`
  content.querySelectorAll<HTMLButtonElement>('[data-customer-view]').forEach((button) => {
    button.addEventListener('click', () => {
      customerListView = button.dataset.customerView === 'archived' ? 'archived' : 'active'
      renderCustomersSection()
    })
  })
  content.querySelectorAll<HTMLButtonElement>('[data-edit-customer]').forEach((button) => {
    button.addEventListener('click', () => {
      const customer = customers.find((item) => item.id === button.dataset.editCustomer)
      if (customer) renderCustomerEditor(customer)
    })
  })
  content.querySelectorAll<HTMLButtonElement>('[data-account-customer]').forEach((button) => {
    button.addEventListener('click', (event) => {
      event.stopPropagation()
      const customer = customers.find((item) => item.id === button.dataset.accountCustomer)
      if (customer) renderCustomerAccountStatement(customer)
    })
  })
}

function getCustomerInvoiceRecords(customer: Customer): InvoiceRecord[] {
  return invoiceRecords
    .filter((record) => record.rootId === record.id)
    .map((root) => getInvoiceRootVersions(root.rootId).at(-1) || root)
    .filter((latest) => {
      const linked = latest.customerId === customer.id
      const nameMatches = normalizeCustomerText(latest.customerName) === normalizeCustomerText(customer.name)
      const phoneMatches = latest.customerPhone.trim()
        && normalizeCustomerPhone(latest.customerPhone) === normalizeCustomerPhone(customer.phone)
      return linked || (nameMatches && (!customer.phone || phoneMatches))
    })
    .sort((a, b) => Number(b.rootInvoiceNumber || b.invoiceNumber) - Number(a.rootInvoiceNumber || a.invoiceNumber))
}

function updateCustomerDeleteAvailability() {
  const button = document.querySelector<HTMLButtonElement>('#delete-customer')
  if (!button || button.classList.contains('cancel-delete-confirm')) return
  const customer = customers.find((item) => item.id === button.dataset.customerId)
  if (!customer) return
  const hasInvoices = !invoicesLoaded || getCustomerInvoiceRecords(customer).length > 0
  button.disabled = hasInvoices
  button.textContent = !invoicesLoaded ? 'جارٍ التحقق من الفواتير' : hasInvoices ? 'لا يمكن الحذف لوجود فواتير' : 'حذف نهائي'
  button.title = !invoicesLoaded
    ? 'انتظر حتى يكتمل تحميل سجل الفواتير.'
    : hasInvoices
      ? 'أرشف الزبون بدلًا من حذفه للحفاظ على سجل فواتيره.'
      : 'حذف نهائي لزبون لا يملك فواتير.'
}

function renderCustomerAccountStatement(customer: Customer) {
  const linkedInvoices = getCustomerInvoiceRecords(customer)
  const total = linkedInvoices.reduce((sum, record) => sum + getInvoiceNetTotal(record), 0)
  const paid = linkedInvoices.reduce((sum, record) => sum + getInvoicePaidTotal(record), 0)
  const remaining = linkedInvoices.reduce((sum, record) => sum + getInvoiceRemainingTotal(record), 0)
  const allPayments = linkedInvoices
    .flatMap((record) => record.payments.map((payment) => ({
      ...payment,
      invoiceNumber: record.rootInvoiceNumber || record.invoiceNumber,
    })))
  .sort((a, b) => (a.date || '').localeCompare(b.date || '') || (a.createdAt || '').localeCompare(b.createdAt || ''))

  const backdrop = modal(`
    <div class="account-statement-modal">
      <div class="account-statement-body">
        <button type="button" class="modal-close" data-close-account aria-label="إغلاق">${svg('close')}</button>
        <p class="eyebrow">كشف حساب زبون</p>
        <h2>${escapeHtml(customer.name)}</h2>
        <div class="account-statement-contact">
          ${customer.phone ? `<span class="account-contact-phone">${escapeHtml(customer.phone)}</span>` : ''}
          ${customer.address ? `<span>${escapeHtml(customer.address)}</span>` : ''}
          ${customer.neighborhood ? `<span>${escapeHtml(customer.neighborhood)}</span>` : ''}
        </div>
        ${customer.notes ? `<p class="account-statement-notes">${escapeHtml(customer.notes)}</p>` : ''}
        <div class="account-statement-summary">
          <div><span>إجمالي الفواتير</span><strong>${formatUsdAmount(total)}</strong></div>
          <div class="is-paid"><span>إجمالي المسدد</span><strong>${formatUsdAmount(paid)}</strong></div>
          <div class="${remaining <= 0.00001 ? 'is-clear' : 'is-due'}"><span>الرصيد المتبقي</span><strong>${formatUsdAmount(remaining)}</strong></div>
        </div>

        <section class="account-statement-section">
          <div class="account-statement-section-head">
            <h3>سجل الدفعات</h3>
            <span>${allPayments.length} دفعة</span>
          </div>
          ${allPayments.length ? `
            <div class="account-payment-timeline">
              ${allPayments.map((payment, paymentIndex) => `
                <article class="account-payment-item">
                  <span class="account-payment-dot" aria-hidden="true"></span>
                  <div class="account-payment-main">
                    <strong>${paymentIndex + 1}. ${money(payment.amount)} $</strong>
                    ${payment.note ? `<p>${escapeHtml(payment.note)}</p>` : ''}
                  </div>
                  <div class="account-payment-meta">
                    <span>${escapeHtml(payment.date || 'بدون تاريخ')}</span>
                    <span>فاتورة ${escapeHtml(payment.invoiceNumber)}</span>
                  </div>
                </article>
              `).join('')}
            </div>
          ` : '<div class="account-statement-empty">لا توجد دفعات مسجلة لهذا الزبون.</div>'}
        </section>

        <section class="account-statement-section">
          <div class="account-statement-section-head">
            <h3>الفواتير المرتبطة</h3>
            <span>${linkedInvoices.length} فاتورة</span>
          </div>
          ${linkedInvoices.length ? `
            <div class="account-invoices-list">
              ${linkedInvoices.map((record) => {
                const net = getInvoiceNetTotal(record)
                const invoicePaid = getInvoicePaidTotal(record)
                const invoiceRemaining = getInvoiceRemainingTotal(record)
                const status = getInvoicePaymentStatus(record)
                return `
                  <article class="account-invoice-card">
                    <div class="account-invoice-head">
                      <strong>فاتورة رقم ${escapeHtml(record.rootInvoiceNumber || record.invoiceNumber)}${record.workshopName?.trim() ? ` | ورشة ${escapeHtml(record.workshopName.trim())}` : ''}</strong>
                      <span class="invoice-status-badge is-${status.key}">${escapeHtml(status.label)}</span>
                    </div>
                    <div class="account-invoice-financials">
                      <div><span>الإجمالي</span><strong>${formatUsdAmount(net)}</strong></div>
                      <div><span>المسدد</span><strong>${formatUsdAmount(invoicePaid)}</strong></div>
                      <div><span>الباقي</span><strong>${formatUsdAmount(invoiceRemaining)}</strong></div>
                    </div>
                    ${record.payments.length ? `
                      <div class="account-invoice-payments">
                        ${[...record.payments].sort((a, b) =>
                          (a.date || '').localeCompare(b.date || '')
                          || (a.createdAt || '').localeCompare(b.createdAt || '')
                        ).map((payment, paymentIndex) => `
                          <span><b>${paymentIndex + 1}. ${money(payment.amount)} $</b> — ${escapeHtml(payment.date || 'بدون تاريخ')}${payment.note ? ` — ${escapeHtml(payment.note)}` : ''}</span>
                        `).join('')}
                      </div>
                    ` : '<span class="account-invoice-no-payments">لا توجد دفعات على هذه الفاتورة</span>'}
                  </article>
                `
              }).join('')}
            </div>
          ` : '<div class="account-statement-empty">لا توجد فواتير مرتبطة بهذا الزبون.</div>'}
        </section>
      </div>

      <div class="account-statement-actions">
        <button type="button" class="secondary-button" data-close-account>إغلاق</button>
        <button type="button" class="primary-button" id="export-account-statement">تصدير كشف الحساب</button>
      </div>
    </div>
  `)

  backdrop.querySelectorAll<HTMLButtonElement>('[data-close-account]').forEach((button) => {
    button.addEventListener('click', () => backdrop.remove())
  })
  backdrop.querySelector<HTMLButtonElement>('#export-account-statement')!.addEventListener('click', () => {
    renderCustomerAccountExportConfirmation(backdrop, customer)
  })
}

function renderCustomerAccountExportConfirmation(accountBackdrop: HTMLDivElement, customer: Customer) {
  const linkedInvoices = getCustomerInvoiceRecords(customer)
  const confirmBackdrop = modal(`
    <div class="account-export-confirmation">
      <div class="account-export-confirmation-body">
        <button type="button" class="modal-close" data-close-account-export aria-label="إغلاق">${svg('close')}</button>
        <p class="eyebrow">تأكيد تصدير الكشف</p>
        <h2>بيانات صورة كشف الحساب</h2>
        <p class="account-export-confirmation-copy">راجع اسم الورشة لكل فاتورة، وأضف ملاحظة اختيارية تظهر في أسفل الصورة.</p>
        <div class="account-export-workshops">
          ${linkedInvoices.length ? linkedInvoices.map((record) => `
            <label>
              <span>فاتورة رقم ${escapeHtml(record.rootInvoiceNumber || record.invoiceNumber)}</span>
              <input type="text"
                maxlength="60"
                data-account-workshop="${escapeHtml(record.id)}"
                value="${escapeHtml(record.workshopName?.trim() || '')}"
                placeholder="اسم الورشة">
            </label>
          `).join('') : '<div class="account-statement-empty">لا توجد فواتير مرتبطة بهذا الزبون.</div>'}
        </div>
        <fieldset class="account-export-note-field">
          <legend>ملاحظة أسفل الكشف</legend>
          <textarea id="account-export-note" maxlength="300" rows="3" placeholder="أدخل ملاحظة اختيارية"></textarea>
        </fieldset>
        <section class="account-export-preview" hidden>
          <div class="account-export-preview-head">
            <strong>معاينة كشف الحساب</strong>
          </div>
          <div class="account-export-preview-frame" id="account-export-preview-pages"></div>
        </section>
      </div>
      <div class="account-statement-actions">
        <button type="button" class="secondary-button" data-close-account-export>رجوع</button>
        <button type="button" class="secondary-button" id="preview-account-export">معاينة</button>
        <button type="button" class="primary-button" id="confirm-account-export">تأكيد التصدير</button>
      </div>
    </div>
  `)

  const previewButton = confirmBackdrop.querySelector<HTMLButtonElement>('#preview-account-export')!
  const previewSection = confirmBackdrop.querySelector<HTMLElement>('.account-export-preview')!
  const previewPages = confirmBackdrop.querySelector<HTMLElement>('#account-export-preview-pages')!
  let previewVisible = false
  let previewUpdateTimer: number | undefined
  let previewRevision = 0

  const collectExportOptions = () => {
    const workshopNames: Record<string, string> = {}
    confirmBackdrop.querySelectorAll<HTMLInputElement>('[data-account-workshop]').forEach((input) => {
      workshopNames[input.dataset.accountWorkshop || ''] = input.value.trim()
    })
    const note = confirmBackdrop.querySelector<HTMLTextAreaElement>('#account-export-note')?.value.trim() || ''
    return { workshopNames, note }
  }

  const closeConfirmation = () => {
    previewRevision += 1
    if (previewUpdateTimer !== undefined) {
      window.clearTimeout(previewUpdateTimer)
      previewUpdateTimer = undefined
    }
    confirmBackdrop.remove()
    document.body.append(accountBackdrop)
  }
  confirmBackdrop.querySelectorAll<HTMLButtonElement>('[data-close-account-export]').forEach((button) => {
    button.addEventListener('click', closeConfirmation)
  })

  const cancelPreview = () => {
    previewRevision += 1
    if (previewUpdateTimer !== undefined) {
      window.clearTimeout(previewUpdateTimer)
      previewUpdateTimer = undefined
    }
    previewVisible = false
    previewSection.hidden = true
    previewPages.replaceChildren()
    previewButton.textContent = 'معاينة'
  }

  const renderPreview = async (scrollIntoView = false) => {
    const revision = ++previewRevision
    const { workshopNames, note } = collectExportOptions()
    const result = await exportCustomerAccountStatementA4(
      previewButton,
      customer,
      workshopNames,
      note,
      true,
      1,
    )
    if (!previewVisible || revision !== previewRevision || !Array.isArray(result)) return false
    result.forEach((canvas, index) => {
      canvas.className = 'account-export-preview-page'
      canvas.setAttribute('role', 'img')
      canvas.setAttribute('aria-label', `معاينة صفحة كشف الحساب ${index + 1}`)
    })
    previewPages.replaceChildren(...result)
    previewSection.hidden = false
    if (scrollIntoView) previewSection.scrollIntoView({ block: 'start' })
    return true
  }

  const schedulePreviewUpdate = () => {
    if (!previewVisible) return
    if (previewUpdateTimer !== undefined) window.clearTimeout(previewUpdateTimer)
    previewUpdateTimer = window.setTimeout(() => {
      previewUpdateTimer = undefined
      void renderPreview()
    }, 100)
  }

  previewButton.addEventListener('click', async () => {
    if (previewVisible) {
      cancelPreview()
      return
    }
    previewVisible = true
    previewButton.textContent = 'إلغاء المعاينة'
    if (!await renderPreview(true) && previewVisible) cancelPreview()
  })
  confirmBackdrop.querySelectorAll<HTMLInputElement>('[data-account-workshop]').forEach((input) => {
    input.addEventListener('input', schedulePreviewUpdate)
  })
  confirmBackdrop.querySelector<HTMLTextAreaElement>('#account-export-note')?.addEventListener('input', schedulePreviewUpdate)
  confirmBackdrop.querySelector<HTMLButtonElement>('#confirm-account-export')!.addEventListener('click', async (event) => {
    previewRevision += 1
    if (previewUpdateTimer !== undefined) {
      window.clearTimeout(previewUpdateTimer)
      previewUpdateTimer = undefined
    }
    const button = event.currentTarget as HTMLButtonElement
    const workshopNames: Record<string, string> = {}
    confirmBackdrop.querySelectorAll<HTMLInputElement>('[data-account-workshop]').forEach((input) => {
      workshopNames[input.dataset.accountWorkshop || ''] = input.value.trim()
    })
    const note = confirmBackdrop.querySelector<HTMLTextAreaElement>('#account-export-note')?.value.trim() || ''
    const exported = await exportCustomerAccountStatementA4(button, customer, workshopNames, note)
    if (exported) confirmBackdrop.remove()
  })
}

async function exportCustomerAccountStatementA4(
  button: HTMLButtonElement,
  customer: Customer,
  workshopNames: Record<string, string>,
  exportNote: string,
  previewOnly = false,
  imageScale: ImageExportScale = highQualityImageScale,
): Promise<boolean | HTMLCanvasElement[]> {
  if (!previewOnly) button.disabled = true
  try {
    void exportCustomerAccountStatement
    const linkedInvoices = getCustomerInvoiceRecords(customer)
    const total = linkedInvoices.reduce((sum, record) => sum + getInvoiceNetTotal(record), 0)
    const paid = linkedInvoices.reduce((sum, record) => sum + getInvoicePaidTotal(record), 0)
    const remaining = linkedInvoices.reduce((sum, record) => sum + getInvoiceRemainingTotal(record), 0)
    const allPayments = linkedInvoices.flatMap((record) =>
      record.payments.map((payment) => ({
        ...payment,
        invoiceNumber: record.rootInvoiceNumber || record.invoiceNumber,
        workshopName: workshopNames[record.id]?.trim() || record.workshopName?.trim() || '',
      })),
    ).sort((a, b) =>
      (a.date || '').localeCompare(b.date || '') || (a.createdAt || '').localeCompare(b.createdAt || ''),
    )

    const width = 1123
    const height = 1587
    const scale = imageScale
    const teal = '#007d79'
    const ink = '#203044'
    const muted = '#718096'
    const line = '#dfe7e9'

    const createPage = () => {
      const canvas = document.createElement('canvas')
      canvas.width = width * scale
      canvas.height = height * scale
      const context = canvas.getContext('2d')
      if (!context) throw new Error('Canvas is unavailable')
      context.scale(scale, scale)
      context.textBaseline = 'middle'
      context.direction = 'rtl'
      context.fillStyle = '#f4f7f6'
      context.fillRect(0, 0, width, height)
      context.fillStyle = teal
      context.fillRect(0, 0, width, 22)
      return { canvas, context }
    }

    const measureLegendWidth = (context: CanvasRenderingContext2D, text: string) => {
      context.save()
      context.font = '800 12px Cairo, sans-serif'
      const legendWidth = Math.max(110, context.measureText(text).width + 28)
      context.restore()
      return legendWidth
    }

    const drawLegend = (
      context: CanvasRenderingContext2D,
      text: string,
      centerX: number,
      centerY: number,
      background: string,
      border: string,
      color: string,
    ) => {
      context.save()
      context.font = '800 12px Cairo, sans-serif'
      context.textAlign = 'center'
      const legendWidth = measureLegendWidth(context, text)
      context.fillStyle = background
      context.strokeStyle = border
      context.lineWidth = 1.5
      context.beginPath()
      context.roundRect(centerX - legendWidth / 2, centerY - 14, legendWidth, 28, 14)
      context.fill()
      context.stroke()
      context.fillStyle = color
      context.fillText(text, centerX, centerY)
      context.restore()
      return legendWidth
    }

    const drawPageHeader = (
      context: CanvasRenderingContext2D,
      title: string,
      pageIndex: number,
      pageCount: number,
    ) => {
      drawCompanyBranding(context, {
        x: 80,
        nameY: 58,
        contactY: 82,
        maxWidth: 380,
        align: 'left',
        nameFont: '800 16px Cairo, sans-serif',
        contactFont: '700 10px Cairo, sans-serif',
        nameColor: ink,
      })
      context.textAlign = 'right'
      context.fillStyle = ink
      context.font = '800 21px Cairo, sans-serif'
      context.fillText(title, 1043, 58)
      context.fillStyle = muted
      context.font = '700 13px Cairo, sans-serif'
      context.fillText(`كشف حساب زبون | صفحة ${pageIndex} من ${pageCount}`, 1043, 84)
    }

    const drawPaymentGrid = (
      context: CanvasRenderingContext2D,
      payments: Array<InvoicePayment & { invoiceNumber?: string; workshopName?: string }>,
      startNumber: number,
      boxX: number,
      boxY: number,
      boxWidth: number,
    ) => {
      const columns = 5
      const rows = Math.ceil(payments.length / columns)
      const gap = 12
      const padding = 18
      const cellWidth = (boxWidth - padding * 2 - gap * (columns - 1)) / columns
      const cellHeight = 58
      const boxHeight = padding * 2 + rows * cellHeight + Math.max(0, rows - 1) * gap
      context.fillStyle = '#fff'
      context.strokeStyle = line
      context.beginPath()
      context.roundRect(boxX, boxY, boxWidth, boxHeight, 12)
      context.fill()
      context.stroke()

      payments.forEach((payment, index) => {
        const row = Math.floor(index / columns)
        const column = columns - 1 - (index % columns)
        const cellX = boxX + padding + column * (cellWidth + gap)
        const cellY = boxY + padding + row * (cellHeight + gap)
        context.fillStyle = '#f7faf9'
        context.beginPath()
        context.roundRect(cellX, cellY, cellWidth, cellHeight, 8)
        context.fill()

        context.fillStyle = teal
        context.beginPath()
        context.arc(cellX + cellWidth - 16, cellY + 14, 8, 0, Math.PI * 2)
        context.fill()
        context.fillStyle = '#fff'
        context.textAlign = 'center'
        context.font = '800 9px Cairo, sans-serif'
        context.fillText(String(startNumber + index), cellX + cellWidth - 16, cellY + 14)

        context.textAlign = 'center'
        context.fillStyle = ink
        context.font = '800 12px Cairo, sans-serif'
        context.fillText(formatUsdAmount(payment.amount), cellX + (cellWidth - 24) / 2, cellY + 18)
        context.fillStyle = muted
        context.font = '700 9px Cairo, sans-serif'
        context.fillText(payment.date || 'بدون تاريخ', cellX + (cellWidth - 24) / 2, cellY + 32)
        if (payment.invoiceNumber) {
          const invoiceLabel = payment.workshopName
            ? `فاتورة ${payment.invoiceNumber} | ورشة ${payment.workshopName}`
            : `فاتورة ${payment.invoiceNumber}`
          context.fillText(invoiceLabel, cellX + (cellWidth - 24) / 2, cellY + 46)
        } else if (payment.note) {
          context.fillText(payment.note, cellX + (cellWidth - 24) / 2, cellY + 46)
        }
      })
      return boxY + boxHeight
    }

    const first = createPage()
    drawPageHeader(first.context, 'كشف حساب زبون', 1, 1)
    first.context.textAlign = 'right'
    first.context.fillStyle = ink
    first.context.font = '800 30px Cairo, sans-serif'
    first.context.fillText(customer.name, 1043, 125)
    first.context.fillStyle = muted
    first.context.font = '700 14px Cairo, sans-serif'
    const contact = [customer.phone, customer.address, customer.neighborhood].filter(Boolean).join(' | ')
    if (contact) first.context.fillText(contact, 1043, 154)
    if (customer.notes) first.context.fillText(customer.notes, 1043, 178)

    const summary = [
      { label: 'إجمالي الفواتير', value: total, color: teal, background: '#edf8f6' },
      { label: 'إجمالي المسدد', value: paid, color: '#166534', background: '#f0faf3' },
      { label: 'الرصيد المتبقي', value: remaining, color: remaining <= 0.00001 ? '#166534' : '#92400e', background: remaining <= 0.00001 ? '#f0faf3' : '#fff8ed' },
    ]
    summary.forEach((item, index) => {
      const cardWidth = 300
      const cardX = 1043 - cardWidth - index * 330
      first.context.fillStyle = item.background
      first.context.strokeStyle = line
      first.context.beginPath()
      first.context.roundRect(cardX, 210, cardWidth, 96, 14)
      first.context.fill()
      first.context.stroke()
      first.context.textAlign = 'center'
      first.context.fillStyle = muted
      first.context.font = '700 14px Cairo, sans-serif'
      first.context.fillText(item.label, cardX + cardWidth / 2, 242)
      first.context.fillStyle = item.color
      first.context.font = '800 23px Cairo, sans-serif'
      first.context.fillText(formatUsdAmount(item.value), cardX + cardWidth / 2, 276)
    })

    first.context.textAlign = 'right'
    first.context.fillStyle = ink
    first.context.font = '800 19px Cairo, sans-serif'
    first.context.fillText(`سجل الدفعات — ${allPayments.length} دفعة`, 1043, 350)
    if (!allPayments.length) {
      first.context.fillStyle = '#fff'
      first.context.strokeStyle = line
      first.context.beginPath()
      first.context.roundRect(80, 380, 963, 70, 12)
      first.context.fill()
      first.context.stroke()
      first.context.textAlign = 'center'
      first.context.fillStyle = muted
      first.context.font = '700 15px Cairo, sans-serif'
      first.context.fillText('لا توجد دفعات مسجلة لهذا الزبون', 561, 415)
      var paymentGridEnd = 466
    } else {
      const paymentRows = Math.ceil(allPayments.length / 5)
      paymentGridEnd = 380 + 36 + paymentRows * 58 + Math.max(0, paymentRows - 1) * 12
      drawPaymentGrid(first.context, allPayments, 1, 80, 380, 963)
    }
    const ctx = first.context
    let invoiceY = paymentGridEnd + 32
    ctx.textAlign = 'right'
    ctx.strokeStyle = line
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(80, paymentGridEnd + 18)
    ctx.lineTo(1043, paymentGridEnd + 18)
    ctx.stroke()
    ctx.fillStyle = ink
    ctx.font = '800 19px Cairo, sans-serif'
    ctx.fillText(`الفواتير المرتبطة — ${linkedInvoices.length} فاتورة`, 1043, paymentGridEnd + 46)

    const canvases: HTMLCanvasElement[] = [first.canvas]
    let activeContext = ctx
    invoiceY = paymentGridEnd + 78

    linkedInvoices.forEach((record) => {
      const sortedPayments = [...record.payments].sort((a, b) =>
        (a.date || '').localeCompare(b.date || '') || (a.createdAt || '').localeCompare(b.createdAt || ''))
      const rows = Math.ceil(sortedPayments.length / 5)
      const paymentsHeight = sortedPayments.length ? 36 + rows * 58 + Math.max(0, rows - 1) * 12 : 56
      const cardHeight = 184 + paymentsHeight
      if (invoiceY + cardHeight > 1480) {
        const nextPage = createPage()
        canvases.push(nextPage.canvas)
        activeContext = nextPage.context
        drawPageHeader(activeContext, 'كشف حساب زبون - متابعة', canvases.length, 0)
        activeContext.textAlign = 'right'
        activeContext.fillStyle = ink
        activeContext.font = '800 19px Cairo, sans-serif'
        activeContext.fillText(`الفواتير المرتبطة — متابعة`, 1043, 120)
        invoiceY = 150
      }

      activeContext.fillStyle = '#fff'
      activeContext.strokeStyle = line
      activeContext.beginPath()
      activeContext.roundRect(80, invoiceY, 963, cardHeight, 14)
      activeContext.fill()
      activeContext.stroke()

      const workshop = workshopNames[record.id]?.trim() || record.workshopName?.trim() || ''
      activeContext.textAlign = 'right'
      activeContext.fillStyle = ink
      activeContext.font = '800 17px Cairo, sans-serif'
      activeContext.fillText(`فاتورة رقم ${record.rootInvoiceNumber || record.invoiceNumber}${workshop ? ` | ورشة ${workshop}` : ''}`, 1012, invoiceY + 32)

      const status = getInvoicePaymentStatus(record)
      const statusStyle = status.key === 'paid'
        ? { background: '#dcfce7', border: '#86efac', color: '#166534' }
        : status.key === 'partial'
          ? { background: '#fef3c7', border: '#fcd34d', color: '#92400e' }
          : { background: '#fee2e2', border: '#fca5a5', color: '#991b1b' }
      const statusCenterX = 150
      const paymentCountLabel = `عدد الدفعات لهذه الفاتورة: ${sortedPayments.length}`
      const statusWidth = drawLegend(activeContext, status.label, statusCenterX, invoiceY + 32, statusStyle.background, statusStyle.border, statusStyle.color)
      const paymentCountWidth = measureLegendWidth(activeContext, paymentCountLabel)
      const paymentCountCenterX = statusCenterX + statusWidth / 2 + 12 + paymentCountWidth / 2
      drawLegend(activeContext, paymentCountLabel, paymentCountCenterX, invoiceY + 32, '#eef9f7', '#9ecdc8', teal)

      const invoiceRemaining = getInvoiceRemainingTotal(record)
      const invoiceSummary = [
        { label: 'الإجمالي', value: getInvoiceNetTotal(record), color: teal, background: '#edf8f6', border: '#b9dcd7' },
        { label: 'المسدد', value: getInvoicePaidTotal(record), color: '#166534', background: '#f0faf3', border: '#bfe4c9' },
        {
          label: 'الباقي',
          value: invoiceRemaining,
          color: invoiceRemaining <= 0.00001 ? '#166534' : '#92400e',
          background: invoiceRemaining <= 0.00001 ? '#f0faf3' : '#fff8ed',
          border: invoiceRemaining <= 0.00001 ? '#bfe4c9' : '#efd39c',
        },
      ]
      invoiceSummary.forEach((item, index) => {
        const cardWidth = 260
        const cardX = 1012 - cardWidth - index * 280
        activeContext.fillStyle = item.background
        activeContext.strokeStyle = item.border
        activeContext.lineWidth = 1
        activeContext.beginPath()
        activeContext.roundRect(cardX, invoiceY + 92, cardWidth, 54, 10)
        activeContext.fill()
        activeContext.stroke()
        activeContext.textAlign = 'center'
        activeContext.fillStyle = muted
        activeContext.font = '700 11px Cairo, sans-serif'
        activeContext.fillText(item.label, cardX + cardWidth / 2, invoiceY + 110)
        activeContext.fillStyle = item.color
        activeContext.font = '800 15px Cairo, sans-serif'
        activeContext.fillText(formatUsdAmount(item.value), cardX + cardWidth / 2, invoiceY + 130)
      })

      if (sortedPayments.length) {
        drawPaymentGrid(activeContext, sortedPayments, 1, 112, invoiceY + 158, 899)
      } else {
        activeContext.textAlign = 'center'
        activeContext.fillStyle = muted
        activeContext.font = '700 13px Cairo, sans-serif'
        activeContext.fillText('لا توجد دفعات على هذه الفاتورة', 561, invoiceY + 182)
      }
      invoiceY += cardHeight + 16
    })

    if (exportNote) {
      ctx.fillStyle = '#eef7f5'
      ctx.strokeStyle = '#b9dcd7'
      ctx.beginPath()
      ctx.roundRect(80, 1488, 963, 60, 12)
      ctx.fill()
      ctx.stroke()
      ctx.textAlign = 'center'
      ctx.fillStyle = muted
      ctx.font = '700 14px Cairo, sans-serif'
      ctx.fillText(`ملاحظة: ${exportNote}`, 561, 1518)
    }

    if (previewOnly) return canvases

    const pageCount = canvases.length
    for (let index = 0; index < canvases.length; index += 1) {
      const blob = await new Promise<Blob>((resolve, reject) => {
        canvases[index].toBlob((result) => result ? resolve(result) : reject(new Error('Failed to create PNG')), 'image/png')
      })
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = `كشف-حساب-${customer.name}-فائقة-الجودة-صفحة-${index + 1}-من-${pageCount}.png`
      document.body.append(link)
      link.click()
      link.remove()
      window.setTimeout(() => URL.revokeObjectURL(url), 1000)
    }
    showToast('تم تصدير كشف الحساب بصور A4 فائقة الجودة.')
    return true
  } catch (error) {
    console.error('Failed to export A4 customer account statement:', error)
    showToast('تعذر تصدير كشف الحساب. حاول مجددًا.')
    return false
  } finally {
    if (!previewOnly) button.disabled = false
  }
}

async function exportCustomerAccountStatement(
  button: HTMLButtonElement,
  customer: Customer,
  workshopNames: Record<string, string>,
  exportNote: string,
  previewOnly = false,
): Promise<boolean | string> {
  button.disabled = true
  try {
    const linkedInvoices = getCustomerInvoiceRecords(customer)
    const total = linkedInvoices.reduce((sum, record) => sum + getInvoiceNetTotal(record), 0)
    const paid = linkedInvoices.reduce((sum, record) => sum + getInvoicePaidTotal(record), 0)
    const remaining = linkedInvoices.reduce((sum, record) => sum + getInvoiceRemainingTotal(record), 0)
    const allPayments = linkedInvoices
      .flatMap((record) => record.payments.map((payment) => ({
        ...payment,
        invoiceNumber: record.rootInvoiceNumber || record.invoiceNumber,
      })))
      .sort((a, b) => (a.date || '').localeCompare(b.date || '') || (a.createdAt || '').localeCompare(b.createdAt || ''))

    const sortPayments = (payments: InvoicePayment[]) => [...payments].sort((a, b) =>
      (a.date || '').localeCompare(b.date || '') || (a.createdAt || '').localeCompare(b.createdAt || ''))

    const paymentHeight = (count: number) => count <= 5
      ? 76 + count * 64
      : (() => {
        const chunks = Array.from({ length: Math.ceil(count / 5) }, (_, index) =>
          Math.min(5, count - index * 5))
        const rows = Math.ceil(chunks.length / 2)
        const lastPair = chunks.slice((rows - 1) * 2)
        const lastRowHeight = 76 + Math.max(...lastPair) * 64
        return Math.max(0, rows - 1) * 410 + lastRowHeight
      })()

    let estimatedHeight = 520
    estimatedHeight += allPayments.length ? paymentHeight(allPayments.length) : 120
    linkedInvoices.forEach((record) => {
      const count = record.payments.length
      estimatedHeight += 196 + (count ? paymentHeight(count) : 56) + 24 + 20
    })
    estimatedHeight += exportNote ? 100 : 50

    const width = 1200
    const scale = 2
    const canvas = document.createElement('canvas')
    canvas.width = width * scale
    canvas.height = estimatedHeight * scale
    const context = canvas.getContext('2d')
    if (!context) throw new Error('Canvas is unavailable')
    context.scale(scale, scale)
    context.textBaseline = 'middle'

    const teal = '#007d79'
    const ink = '#203044'
    const muted = '#718096'
    const line = '#dfe7e9'
    const drawLegend = (
      text: string,
      centerX: number,
      centerY: number,
      background: string,
      border: string,
      color: string,
    ) => {
      context.save()
      context.font = '800 13px Cairo, sans-serif'
      context.textAlign = 'center'
      const width = Math.max(108, context.measureText(text).width + 28)
      context.fillStyle = background
      context.strokeStyle = border
      context.lineWidth = 1.5
      context.beginPath()
      context.roundRect(centerX - width / 2, centerY - 15, width, 30, 15)
      context.fill()
      context.stroke()
      context.fillStyle = color
      context.fillText(text, centerX, centerY)
      context.restore()
    }
    context.fillStyle = '#f4f7f6'
    context.fillRect(0, 0, width, estimatedHeight)
    context.fillStyle = teal
    context.fillRect(0, 0, width, 24)

    context.textAlign = 'right'
    context.fillStyle = ink
    context.font = '800 24px Cairo, sans-serif'
    context.fillText('كشف حساب زبون', 1120, 72)
    drawCompanyBranding(context, {
      x: 80,
      nameY: 72,
      contactY: 100,
      maxWidth: 400,
      align: 'left',
      nameFont: '800 20px Cairo, sans-serif',
      contactFont: '700 12px Cairo, sans-serif',
      nameColor: ink,
    })
    context.font = '800 38px Cairo, sans-serif'
    context.fillText(customer.name, 1120, 118)
    context.fillStyle = muted
    context.font = '700 18px Cairo, sans-serif'
    const contact = [customer.phone, customer.address, customer.neighborhood].filter(Boolean).join('  |  ')
    if (contact) context.fillText(contact, 1120, 158)
    if (customer.notes) {
      context.font = '600 16px Cairo, sans-serif'
      context.fillText(customer.notes, 1120, 188)
    }

    let y = 230
    const summary = [
      { label: 'إجمالي الفواتير', value: total, color: teal, background: '#edf8f6' },
      { label: 'إجمالي المسدد', value: paid, color: '#166534', background: '#f0faf3' },
      { label: 'الرصيد المتبقي', value: remaining, color: remaining <= 0.00001 ? '#166534' : '#92400e', background: remaining <= 0.00001 ? '#f0faf3' : '#fff8ed' },
    ]
    summary.forEach((item, index) => {
      const cardWidth = 330
      const cardRight = 1120 - index * 355
      const cardX = cardRight - cardWidth
      context.fillStyle = item.background
      context.strokeStyle = line
      context.lineWidth = 2
      context.beginPath()
      context.roundRect(cardX, y, cardWidth, 124, 18)
      context.fill()
      context.stroke()
      context.textAlign = 'center'
      context.fillStyle = muted
      context.font = '700 17px Cairo, sans-serif'
      context.fillText(item.label, cardX + cardWidth / 2, y + 42)
      context.fillStyle = item.color
      context.font = '800 30px Cairo, sans-serif'
      context.fillText(formatUsdAmount(item.value), cardX + cardWidth / 2, y + 88)
    })

    y = 390
    context.textAlign = 'right'
    context.fillStyle = ink
    context.font = '800 24px Cairo, sans-serif'
    context.fillText(`سجل الدفعات — ${allPayments.length} دفعة`, 1120, y)
    y += 44

    const drawPaymentRow = (
      payment: InvoicePayment & { invoiceNumber?: string },
      number: number,
      x: number,
      rowY: number,
      rowWidth: number,
      compact: boolean,
    ) => {
      const itemHeight = 54
      const itemX = x + 18
      const itemWidth = rowWidth - 36
      context.fillStyle = '#f7faf9'
      context.beginPath()
      context.roundRect(itemX, rowY, itemWidth, itemHeight, 10)
      context.fill()

      context.fillStyle = teal
      context.beginPath()
      context.arc(itemX + itemWidth - 27, rowY + itemHeight / 2, 13, 0, Math.PI * 2)
      context.fill()
      context.fillStyle = '#fff'
      context.textAlign = 'center'
      context.font = '800 12px Cairo, sans-serif'
      context.fillText(String(number), itemX + itemWidth - 27, rowY + itemHeight / 2)

      context.textAlign = 'right'
      context.fillStyle = ink
      context.font = compact ? '800 16px Cairo, sans-serif' : '800 13px Cairo, sans-serif'
      context.fillText(formatUsdAmount(payment.amount), itemX + itemWidth - 52, rowY + 19)
      context.fillStyle = muted
      context.font = compact ? '700 13px Cairo, sans-serif' : '700 11px Cairo, sans-serif'
      const details = `${payment.invoiceNumber ? `فاتورة ${payment.invoiceNumber}  |  ` : ''}${payment.date || 'بدون تاريخ'}${payment.note ? `  |  ${payment.note}` : ''}`
      context.fillText(details, itemX + itemWidth - 52, rowY + 40)
    }

    if (!allPayments.length) {
      context.fillStyle = '#fff'
      context.strokeStyle = line
      context.beginPath()
      context.roundRect(80, y, 1040, 90, 16)
      context.fill()
      context.stroke()
      context.textAlign = 'center'
      context.fillStyle = muted
      context.font = '700 18px Cairo, sans-serif'
      context.fillText('لا توجد دفعات مسجلة لهذا الزبون', 600, y + 45)
      y += 120
    } else if (allPayments.length <= 5) {
      const height = 76 + allPayments.length * 64
      context.fillStyle = '#fff'
      context.strokeStyle = line
      context.beginPath()
      context.roundRect(80, y, 1040, height, 16)
      context.fill()
      context.stroke()
      drawLegend(
        `عدد الدفعات: ${allPayments.length}`,
        1090 - 55,
        y,
        '#eef9f7',
        '#9ecdc8',
        teal,
      )
      allPayments.forEach((payment, index) => drawPaymentRow(payment, index + 1, 80, y + 58 + index * 64, 1040, true))
      y += height + 20
    } else {
      const chunks = Array.from({ length: Math.ceil(allPayments.length / 5) }, (_, index) =>
        allPayments.slice(index * 5, index * 5 + 5))
      chunks.forEach((chunk, chunkIndex) => {
        const row = Math.floor(chunkIndex / 2)
        const column = chunkIndex % 2
        const boxX = column === 0 ? 620 : 100
        const boxY = y + row * 410
        const height = 76 + chunk.length * 64
        context.fillStyle = '#fff'
        context.strokeStyle = line
        context.beginPath()
        context.roundRect(boxX, boxY, 500, height, 16)
        context.fill()
        context.stroke()
        drawLegend(
          `عدد الدفعات: ${chunk.length}`,
          boxX + 375,
          boxY,
          '#eef9f7',
          '#9ecdc8',
          teal,
        )
        chunk.forEach((payment, index) =>
          drawPaymentRow(payment, chunkIndex * 5 + index + 1, boxX, boxY + 58 + index * 64, 500, false))
      })
      y += Math.ceil(chunks.length / 2) * 410
    }

    y += 20
    context.textAlign = 'right'
    context.fillStyle = ink
    context.font = '800 24px Cairo, sans-serif'
    context.fillText(`الفواتير المرتبطة — ${linkedInvoices.length} فاتورة`, 1120, y)
    y += 44

    linkedInvoices.forEach((record) => {
      const sortedPayments = sortPayments(record.payments)
      let paymentsHeight = 56
      if (sortedPayments.length <= 5 && sortedPayments.length > 0) {
        paymentsHeight = 76 + sortedPayments.length * 64
      } else if (sortedPayments.length > 5) {
        const chunks = Array.from({ length: Math.ceil(sortedPayments.length / 5) }, (_, index) =>
          sortedPayments.slice(index * 5, index * 5 + 5))
        const rows = Math.ceil(chunks.length / 2)
        const lastPair = chunks.slice((rows - 1) * 2)
        const lastRowHeight = 76 + Math.max(...lastPair.map((chunk) => chunk.length)) * 64
        paymentsHeight = Math.max(0, rows - 1) * 410 + lastRowHeight
      }
      const cardHeight = 196 + paymentsHeight + 24
      context.fillStyle = '#fff'
      context.strokeStyle = line
      context.beginPath()
      context.roundRect(80, y, 1040, cardHeight, 16)
      context.fill()
      context.stroke()

      const workshop = workshopNames[record.id]?.trim() || record.workshopName?.trim() || ''
      context.textAlign = 'right'
      context.fillStyle = ink
      context.font = '800 21px Cairo, sans-serif'
      context.fillText(`فاتورة رقم ${record.rootInvoiceNumber || record.invoiceNumber}${workshop ? ` | ورشة ${workshop}` : ''}`, 1088, y + 42)
      const status = getInvoicePaymentStatus(record)
      if (status.key === 'paid') {
        drawLegend(status.label, 185, y + 5, '#dcfce7', '#86efac', '#166534')
      } else if (status.key === 'partial') {
        drawLegend(status.label, 185, y + 5, '#fef3c7', '#fcd34d', '#92400e')
      } else {
        drawLegend(status.label, 185, y + 5, '#fee2e2', '#fca5a5', '#991b1b')
      }

      const invoiceSummary = [
        { label: 'الإجمالي', value: getInvoiceNetTotal(record) },
        { label: 'المسدد', value: getInvoicePaidTotal(record) },
        { label: 'الباقي', value: getInvoiceRemainingTotal(record) },
      ]
      invoiceSummary.forEach((item, index) => {
        const cardRight = 1044 - index * 260
        context.fillStyle = '#f7faf9'
        context.beginPath()
        context.roundRect(cardRight - 224, y + 112, 224, 62, 12)
        context.fill()
        context.textAlign = 'center'
        context.fillStyle = muted
        context.font = '700 14px Cairo, sans-serif'
        context.fillText(item.label, cardRight - 112, y + 132)
        context.fillStyle = ink
        context.font = '800 18px Cairo, sans-serif'
        context.fillText(formatUsdAmount(item.value), cardRight - 112, y + 158)
      })

      const paymentY = y + 196
      if (!sortedPayments.length) {
        context.textAlign = 'right'
        context.fillStyle = muted
        context.font = '700 15px Cairo, sans-serif'
        context.fillText('لا توجد دفعات على هذه الفاتورة', 1088, paymentY + 28)
      } else if (sortedPayments.length <= 5) {
        const paymentContainerHeight = 76 + sortedPayments.length * 64
        context.fillStyle = '#f7faf9'
        context.strokeStyle = line
        context.beginPath()
        context.roundRect(100, paymentY, 1000, paymentContainerHeight, 14)
        context.fill()
        context.stroke()
        drawLegend(
          `عدد الدفعات لهذه الفاتورة: ${sortedPayments.length}`,
          600,
          paymentY,
          '#eef9f7',
          '#9ecdc8',
          teal,
        )
        sortedPayments.forEach((payment, index) =>
          drawPaymentRow(payment, index + 1, 100, paymentY + 48 + index * 64, 1000, true))
      } else {
        const chunks = Array.from({ length: Math.ceil(sortedPayments.length / 5) }, (_, index) =>
          sortedPayments.slice(index * 5, index * 5 + 5))
        chunks.forEach((chunk, chunkIndex) => {
          const row = Math.floor(chunkIndex / 2)
          const column = chunkIndex % 2
          const boxX = column === 0 ? 620 : 100
          const boxY = paymentY + row * 410
          context.fillStyle = '#f7faf9'
          context.strokeStyle = line
          context.beginPath()
          context.roundRect(boxX, boxY, 480, 76 + chunk.length * 64, 14)
          context.fill()
          context.stroke()
          drawLegend(
            `عدد الدفعات لهذه الفاتورة: ${chunk.length}`,
            boxX + 240,
            boxY,
            '#eef9f7',
            '#9ecdc8',
            teal,
          )
          chunk.forEach((payment, index) =>
            drawPaymentRow(payment, chunkIndex * 5 + index + 1, boxX, boxY + 48 + index * 64, 480, false))
        })
      }
      y += cardHeight + 20
    })

    if (exportNote) {
      y += 24
      context.fillStyle = '#eef7f5'
      context.strokeStyle = '#b9dcd7'
      context.beginPath()
      context.roundRect(80, y, 1040, 76, 14)
      context.fill()
      context.stroke()
      context.textAlign = 'center'
      context.fillStyle = muted
      context.font = '700 15px Cairo, sans-serif'
      context.fillText(`ملاحظة: ${exportNote}`, 600, y + 38)
    }

    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((result) => result ? resolve(result) : reject(new Error('Failed to create PNG')), 'image/png')
    })
    if (previewOnly) return canvas.toDataURL('image/png')
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `كشف-حساب-${customer.name}-${new Date().toISOString().slice(0, 10)}.png`
    document.body.append(link)
    link.click()
    link.remove()
    window.setTimeout(() => URL.revokeObjectURL(url), 1000)
    showToast('تم تصدير كشف الحساب كصورة.')
    return true
  } catch (error) {
    console.error('Failed to export customer account statement:', error)
    showToast('تعذر تصدير كشف الحساب. حاول مجددًا.')
    return false
  } finally {
    button.disabled = false
  }
}

function renderInvoicesSection() {
  const content = document.querySelector<HTMLElement>('#main-section-content')
  const count = document.querySelector<HTMLElement>('#service-count')
  if (!content) return
  const search = getMainSearchQuery()
  const roots = [...invoiceRecords]
    .filter((record) => record.rootId === record.id)
    .sort((a, b) => Number(b.rootInvoiceNumber || b.invoiceNumber) - Number(a.rootInvoiceNumber || a.invoiceNumber))
    .filter((record) => {
      const versions = getInvoiceRootVersions(record.rootId)
      const latest = versions[versions.length - 1] || record
      return [
        record.invoiceNumber,
        record.rootInvoiceNumber,
        latest.invoiceNumber,
        latest.rootInvoiceNumber,
        latest.customerName,
        latest.customerPhone,
        latest.workshopName,
        latest.workshopName ? `ورشة ${latest.workshopName}` : '',
      ].join(' ').toLocaleLowerCase('ar').includes(search)
    })
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
        const workshopName = latest.workshopName?.trim() || ''
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
          <fieldset class="service-row invoice-row invoice-summary-card">
            ${workshopName ? `<legend class="invoice-summary-workshop">ورشة ${escapeHtml(workshopName)}</legend>` : ''}
            <button class="invoice-summary-main" type="button" data-open-invoice-root="${record.rootId}" aria-label="فتح الفاتورة رقم ${escapeHtml(record.rootInvoiceNumber || record.invoiceNumber)}">
              <header class="invoice-summary-head">
                <div class="invoice-summary-identity">
                  <span class="service-order" aria-label="فاتورة ${index + 1}">${index + 1}</span>
                  <div class="invoice-summary-titles">
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
                  <strong class="invoice-metric-value">${money(net)} <small>$</small></strong>
                </div>
                <div class="invoice-metric is-paid">
                  <span class="invoice-metric-label">المسدد</span>
                  <strong class="invoice-metric-value">${money(paid)} <small>$</small></strong>
                </div>
                <div class="invoice-metric is-remaining ${remaining <= 0.00001 ? 'is-clear' : 'is-due'}">
                  <span class="invoice-metric-label">الباقي</span>
                  <strong class="invoice-metric-value">${money(remaining)} <small>$</small></strong>
                </div>
              </section>
            </button>
            <div class="invoice-summary-extra" hidden>
              <footer class="invoice-summary-meta">
                <span class="invoice-meta-chip"><span>تاريخ البدء</span><strong>${escapeHtml(startDate)}</strong></span>
                <span class="invoice-meta-chip"><span>آخر تحديث</span><strong>${escapeHtml(lastUpdate)}</strong></span>
                ${hasDiscount ? `<span class="invoice-meta-chip"><span>قبل الخصم</span><strong>${formatUsdAmount(latest.total)}</strong></span><span class="invoice-meta-chip"><span>الخصم</span><strong>${formatUsdAmount(latest.discount!.amount)}</strong></span>` : ''}
                      <span class="invoice-meta-chip"><span>بعد الخصم</span><strong>${formatUsdAmount(net)}</strong></span>
                <span class="invoice-meta-chip"><span>عدد الدفعات</span><strong>${paymentsCount}</strong></span>
              </footer>
            </div>
            <button class="invoice-summary-toggle" type="button" aria-expanded="false" aria-label="عرض تفاصيل إضافية للفاتورة">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 9l6 6 6-6"></path></svg>
            </button>
          </fieldset>
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
  if (!head || !content) return
  if (search) {
    search.classList.toggle('invoice-search-input', activeMainSection === 'invoices')
    search.placeholder = activeMainSection === 'services'
      ? 'ابحث عن خدمة...'
      : activeMainSection === 'customers'
        ? 'ابحث عن زبون...'
        : 'ابحث برقم الفاتورة أو الزبون أو الورشة أو الهاتف'
    search.value = ''
  }
  if (addButton) {
    addButton.hidden = activeMainSection === 'invoices'
    const label = activeMainSection === 'customers' ? 'إضافة زبون' : 'إضافة خدمة'
    addButton.setAttribute('aria-label', label)
    addButton.title = label
    addButton.innerHTML = `${svg('plus')}<span>${label}</span>`
  }
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
        <button class="icon-button" id="open-export" aria-label="تجهيز فاتورة" title="تجهيز فاتورة">${svg('invoice')}</button>
        <button class="icon-button" id="open-settings" aria-label="الإعدادات">${svg('settings')}</button>
      </header>
      <nav class="main-sections" aria-label="الأقسام">
        <button type="button" data-main-section="services" class="active">الخدمات والأسعار</button>
        <button type="button" data-main-section="customers">الزبائن</button>
        <button type="button" data-main-section="invoices">سجل الفواتير</button>
      </nav>
      <section class="list-head" id="main-section-head">
        <h1>الخدمات والأسعار <span id="service-count"></span></h1>
        <button type="button" class="icon-button add-button" id="main-add" aria-label="إضافة خدمة" title="إضافة خدمة">${svg('plus')}<span>إضافة خدمة</span></button>
      </section>
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
  const initiallyLinkedInvoices = existing ? getCustomerInvoiceRecords(existing).length > 0 : false
  const element = modal(`
    <button class="modal-close" aria-label="إغلاق">${svg('close')}</button>
    <p class="eyebrow">${existing ? 'تعديل الزبون' : 'زبون جديد'}</p>
    <h2>${existing ? escapeHtml(existing.name) : 'إضافة زبون'}</h2>
    <form id="customer-form" class="service-form customer-form">
      <label>اسم الزبون<input name="name" maxlength="20" required value="${existing ? escapeHtml(existing.name) : ''}" placeholder="اسم الزبون"></label>
      <label>رقم الهاتف<input name="phone" type="tel" maxlength="15" value="${existing ? escapeHtml(existing.phone) : ''}" placeholder="رقم الهاتف"></label>
      <label>العنوان<input name="address" maxlength="15" value="${existing ? escapeHtml(existing.address) : ''}" placeholder="عنوان الزبون"></label>
      <label>الحي<input name="neighborhood" maxlength="15" value="${existing ? escapeHtml(existing.neighborhood) : ''}" placeholder="الحي"></label>
      <label class="customer-notes-field">ملاحظات<textarea name="notes" maxlength="400" rows="3" placeholder="ملاحظات">${existing ? escapeHtml(existing.notes) : ''}</textarea></label>
      <p class="modal-error" id="customer-error" role="alert" aria-live="polite"></p>
      <div class="modal-actions">
        ${existing
          ? `<button class="danger-button" id="delete-customer" data-customer-id="${escapeHtml(existing.id)}" type="button" ${!invoicesLoaded || initiallyLinkedInvoices ? 'disabled' : ''}>${!invoicesLoaded ? 'جارٍ التحقق من الفواتير' : initiallyLinkedInvoices ? 'لا يمكن الحذف لوجود فواتير' : 'حذف نهائي'}</button>
            <button class="primary-button" id="save-customer" type="submit">حفظ التعديل</button>
            <button class="secondary-button" type="submit" data-customer-action="${existing.archived ? 'restore' : 'archive'}">${existing.archived ? 'استعادة الزبون' : 'أرشفة الزبون'}</button>`
          : '<button class="secondary-button" id="cancel-customer" type="button">إلغاء</button><button class="primary-button" id="save-customer" type="submit">حفظ الزبون</button>'}
      </div>
    </form>`)
  element.querySelector('.modal-close')!.addEventListener('click', () => element.remove())
  element.querySelector('#cancel-customer')?.addEventListener('click', () => element.remove())
  const form = element.querySelector<HTMLFormElement>('#customer-form')!
  const error = element.querySelector<HTMLElement>('#customer-error')!
  const nameInput = form.querySelector<HTMLInputElement>('input[name="name"]')!
  const phoneInput = form.querySelector<HTMLInputElement>('input[name="phone"]')!
  const addressInput = form.querySelector<HTMLInputElement>('input[name="address"]')!
  const neighborhoodInput = form.querySelector<HTMLInputElement>('input[name="neighborhood"]')!
  const submitButton = form.querySelector<HTMLButtonElement>('#save-customer')!
  const archiveButton = form.querySelector<HTMLButtonElement>('[data-customer-action]')
  let deleteConfirmationActive = false
  let savingCustomer = false
  const updateNeighborhoodAvailability = (clearWhenDisabled = false) => {
    const hasAddress = Boolean(addressInput.value.trim())
    if (!hasAddress && clearWhenDisabled) neighborhoodInput.value = ''
    neighborhoodInput.disabled = !hasAddress
  }
  const updateCustomerIdentityWarning = () => {
    if (deleteConfirmationActive || savingCustomer) return
    const name = nameInput.value.trim()
    const identityMatch = name
      ? findCustomerIdentityMatch(name, phoneInput.value, addressInput.value, neighborhoodInput.value, existing?.id)
      : null
    error.textContent = identityMatch ? customerIdentityMessage(identityMatch, 'customer') : ''
    submitButton.disabled = !name || Boolean(identityMatch)
  }
  updateNeighborhoodAvailability()
  ;[nameInput, phoneInput, neighborhoodInput].forEach((input) => {
    input.addEventListener('input', updateCustomerIdentityWarning)
  })
  addressInput.addEventListener('input', () => {
    updateNeighborhoodAvailability(true)
    updateCustomerIdentityWarning()
  })
  updateCustomerIdentityWarning()
  form.addEventListener('submit', async (event) => {
    event.preventDefault()
    const submitter = (event as SubmitEvent).submitter
    const customerAction = submitter instanceof HTMLButtonElement
      ? submitter.dataset.customerAction
      : undefined
    if (existing && deleteConfirmationActive) {
      if (customerAction) return
      if (!invoicesLoaded || getCustomerInvoiceRecords(existing).length > 0) {
        deleteConfirmationActive = false
        submitButton.textContent = 'حفظ التعديل'
        submitButton.className = 'primary-button'
        if (archiveButton) archiveButton.disabled = false
        updateCustomerDeleteAvailability()
        error.textContent = 'لا يمكن حذف هذا الزبون لوجود فواتير مرتبطة به. يمكنك أرشفته بدلًا من ذلك.'
        return
      }
      submitButton.disabled = true
      try {
        await deleteDoc(doc(db, 'users', dataUserId, 'customers', existing.id))
        element.remove()
      } catch (deleteError) {
        submitButton.disabled = false
        error.textContent = friendlyError(deleteError)
      }
      return
    }
    const data = new FormData(form)
    const name = String(data.get('name') || '').trim()
    const phone = String(data.get('phone') || '').trim()
    const address = String(data.get('address') || '').trim()
    const neighborhood = neighborhoodInput.value.trim()
    const notes = String(data.get('notes') || '').trim()
    if (!name) { error.textContent = 'أدخل اسم الزبون.'; return }
    const invalidField = [
      { label: 'اسم الزبون', value: name, max: 20 },
      { label: 'رقم الهاتف', value: phone, max: 15 },
      { label: 'العنوان', value: address, max: 15 },
      { label: 'الحي', value: neighborhood, max: 15 },
    ].find(({ value, max }) => value.length > max)
    if (invalidField) {
      error.textContent = `يجب ألا يتجاوز ${invalidField.label} ${invalidField.max} حرفًا.`
      return
    }
    const identityMatch = findCustomerIdentityMatch(name, phone, address, neighborhood, existing?.id)
    if (identityMatch) {
      error.textContent = customerIdentityMessage(identityMatch, 'customer')
      return
    }
    const now = new Date().toISOString()
    const documentData = {
      name,
      phone,
      address,
      neighborhood,
      notes,
      archived: customerAction === 'archive'
        ? true
        : customerAction === 'restore'
          ? false
          : existing?.archived === true,
      createdAt: existing?.createdAt || now,
      updatedAt: now,
    }
    savingCustomer = true
    submitButton.disabled = true
    if (archiveButton) archiveButton.disabled = true
    const previousCustomerListView = customerListView
    if (existing && customerAction) {
      customers = customers.map((customer) => customer.id === existing.id
        ? { ...customer, ...documentData }
        : customer)
      if (customerAction === 'restore') customerListView = 'active'
      renderCustomersSection()
    }
    try {
      if (existing) await updateDoc(doc(db, 'users', dataUserId, 'customers', existing.id), documentData)
      else await addDoc(collection(db, 'users', dataUserId, 'customers'), documentData)
      element.remove()
      if (customerAction) renderCustomersSection()
      if (customerAction === 'archive') showToast('تمت أرشفة الزبون مع الاحتفاظ بسجل فواتيره.')
      if (customerAction === 'restore') showToast('تمت استعادة الزبون إلى القائمة النشطة.')
    } catch (saveError) {
      savingCustomer = false
      if (existing && customerAction) {
        customers = customers.map((customer) => customer.id === existing.id ? existing : customer)
        customerListView = previousCustomerListView
        renderCustomersSection()
      }
      updateCustomerIdentityWarning()
      if (archiveButton) archiveButton.disabled = false
      if (!error.textContent) error.textContent = friendlyError(saveError)
    }
  })
  element.querySelector('#delete-customer')?.addEventListener('click', () => {
    if (!existing) return
    const deleteButton = element.querySelector<HTMLButtonElement>('#delete-customer')!
    if (!invoicesLoaded || getCustomerInvoiceRecords(existing).length > 0) {
      updateCustomerDeleteAvailability()
      error.textContent = 'لا يمكن حذف هذا الزبون لوجود فواتير مرتبطة به. يمكنك أرشفته بدلًا من ذلك.'
      return
    }
    deleteConfirmationActive = !deleteConfirmationActive
    if (deleteConfirmationActive) {
      if (archiveButton) archiveButton.disabled = true
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
    if (archiveButton) archiveButton.disabled = false
    element.querySelector('#customer-error')!.textContent = ''
    updateCustomerDeleteAvailability()
    updateCustomerIdentityWarning()
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
      <label>مبلغ الدفعة بال$<input name="amount" type="number" min="0.01" max="${remaining}" step="0.01" inputmode="decimal" required placeholder="0.00"><small>المبلغ المتبقي الحالي: ${money(remaining)} $</small></label>
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
      error.textContent = `لا يمكن أن تتجاوز الدفعة المبلغ المتبقي (${money(remaining)} $).`
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
    showToast(`لا يمكن أن يتجاوز مجموع الدفعات صافي الفاتورة (${money(netTotal)} $).`)
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
      <label>مبلغ الدفعة بال$<input name="amount" type="number" min="0.01" max="${maxAmount}" step="0.01" inputmode="decimal" required value="${escapeHtml(String(payment.amount))}"><small>الحد الأقصى لهذه الدفعة الآن: ${money(maxAmount)} $</small></label>
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
      error.textContent = `لا يمكن أن تتجاوز هذه الدفعة ${money(maxAmount)} $ حتى لا يتجاوز مجموع الدفعات صافي الفاتورة.`
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
    <p>سيتم حذف الدفعة بمبلغ <strong>${money(payment.amount)} $</strong>${payment.date ? ` بتاريخ ${escapeHtml(payment.date)}` : ''} وتحديث المتبقي وحالة الفاتورة الأساسية.</p>
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
    </section>`, { preserveExisting: true })
  const modalSection = element.querySelector<HTMLElement>('.modal')!
  modalSection.classList.add('invoice-history-modal', 'invoice-corrections-modal')
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
    <h2>الفاتورة رقم ${escapeHtml(root.rootInvoiceNumber || root.invoiceNumber)}</h2>
    <div class="invoice-history-shell invoice-base-shell">
      <section class="invoice-versions-list">
        <article class="invoice-version-card invoice-base-card">
          <span class="invoice-status-badge is-${status.key}">${escapeHtml(status.label)}</span>
          <div class="invoice-version-head">
            ${latest.workshopName?.trim() ? `<span class="invoice-summary-workshop">ورشة ${escapeHtml(latest.workshopName.trim())}</span>` : ''}
          </div>
          <button class="invoice-status-badge is-neutral invoice-corrections-log-button" type="button" id="invoice-corrections-log" title="سجل التعديلات والحركات">سجل الحركات</button>
          <p class="invoice-version-customer">${escapeHtml(latest.customerName || 'بدون اسم زبون')}${latest.customerPhone ? ` <span>• ${escapeHtml(latest.customerPhone)}</span>` : ''}${latest.customerAddress ? ` <span>• ${escapeHtml(latest.customerAddress)}</span>` : ''}</p>
          ${latest.responsibleTeacherName ? `<p class="invoice-version-teacher">المعلم المسؤول: ${escapeHtml(latest.responsibleTeacherName)}</p>` : ''}
          <div class="invoice-version-financials">
            <div class="invoice-financial-item">
              <span>الإجمالي</span>
              <strong>${money(latest.total)} <small>$</small></strong>
            </div>
            ${latest.discount ? `<div class="invoice-financial-item">
              <span>الخصم</span>
              <strong>${money(latest.discount.amount)} <small>$</small></strong>
            </div>` : ''}
            <div class="invoice-financial-item">
              <span>الصافي</span>
              <strong>${money(net)} <small>$</small></strong>
            </div>
            <div class="invoice-financial-item">
              <span>المدفوع</span>
              <strong>${money(paymentsTotal)} <small>$</small></strong>
            </div>
            <div class="invoice-financial-item is-remaining">
              <span>المتبقي</span>
              <strong>${money(remaining)} <small>$</small></strong>
            </div>
          </div>
        </article>

        <div class="invoice-ledger-section">
          <div class="invoice-ledger-head">
            <strong>سجلات الدفعات <span class="invoice-payment-count" aria-label="عدد الدفعات المدفوعة">${paymentEntries.length}</span></strong>
            <button class="secondary-button" type="button" id="invoice-add-payment-entry"${remaining <= 0.00001 ? ' disabled' : ''}>إضافة دفعة</button>
          </div>
          ${paymentEntries.length ? `<div class="invoice-payment-records">${paymentEntries.map(({ payment, index }) => `
            <article class="invoice-payment-record">
              <div class="invoice-payment-record-main">
                <strong>${money(payment.amount)} $</strong>
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
        <button class="primary-button" type="button" id="invoice-history-correct">تعديل الفاتورة</button>
      </div>
    </div>`)
  const modalSection = element.querySelector<HTMLElement>('.modal')!
  modalSection.classList.add('invoice-history-modal')
  element.querySelector('.modal-close')!.addEventListener('click', () => element.remove())

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
    renderInvoiceExportSnapshotDialog(latest)
  })
  element.querySelector<HTMLButtonElement>('#invoice-history-correct')!.addEventListener('click', () => {
    renderExportDialog({ sourceRecord: latest, correction: true })
  })
}

function renderServiceEditor(existing?: WorkService) {
  if (!currentUser) return
  const defaultUnits = settings.measurementUnits.filter((unit) => unit.isDefault)
  if (!existing && !defaultUnits.length) {
    showToast('فعّل وحدة قياس واحدة على الأقل من تبويب وحدات القياس قبل إضافة خدمة.')
    return
  }
  const initialUnit = existing?.unit
    || defaultUnits.find((unit) => unit.id === 'SQM')?.id
    || defaultUnits[0]?.id
    || ''
  const unitOptions = [...defaultUnits]
  if (existing && !unitOptions.some((unit) => unit.id === existing.unit)) {
    const registered = settings.measurementUnits.find((unit) => unit.id === existing.unit)
    unitOptions.push(registered || {
      id: existing.unit,
      name: serviceUnitLabel(existing.unit),
      isDefault: false,
      isSystem: false,
    })
  }
  const unitOptionsMarkup = unitOptions.map((unit, index) => `
    <button type="button" class="custom-select-option ${index >= 2 ? 'custom-select-extra' : ''}" role="option" data-value="${escapeHtml(unit.id)}" data-label="${escapeHtml(unit.name)}" ${index >= 2 ? 'hidden' : ''}>${escapeHtml(unit.name)}</button>`).join('')
  const moreUnitsMarkup = unitOptions.length > 2
    ? '<button type="button" class="custom-select-more" aria-expanded="false">عرض المزيد من وحدات القياس</button>'
    : ''
  const element = modal(`
    <button class="modal-close" aria-label="إغلاق">${svg('close')}</button>
    <p class="eyebrow">${existing ? 'تعديل الخدمة' : 'خدمة جديدة'}</p>
    <h2>${existing ? escapeHtml(existing.name) : 'إضافة خدمة'}</h2>
    <form id="service-form" class="service-form">
      <label>اسم الخدمة<input name="name" maxlength="50" required value="${existing ? escapeHtml(existing.name) : ''}" placeholder="مثال: تركيب السيراميك"></label>
      <label>السعر<input name="price" type="number" min="0" step="0.01" inputmode="decimal" required value="${existing ? existing.price : ''}" placeholder="0.00"></label>
      <div class="custom-select-field" data-custom-select="unit" data-selected="${escapeHtml(initialUnit)}">
        <span class="custom-select-label-title">وحدة القياس</span>
        <button type="button" class="custom-select-trigger" aria-haspopup="listbox" aria-expanded="false">
          <span class="custom-select-value"></span>
          <svg class="custom-select-chevron" viewBox="0 0 24 24" aria-hidden="true"><path d="m7 10 5 5 5-5"/></svg>
        </button>
        <div class="custom-select-menu" role="listbox" hidden>
          ${unitOptionsMarkup}
          ${moreUnitsMarkup}
        </div>
        <input type="hidden" name="unit" value="${escapeHtml(initialUnit)}">
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
    if (name.length > 50) { error.textContent = 'يجب ألا يتجاوز اسم الخدمة 50 حرفًا.'; return }
    if (!Number.isFinite(price) || price < 0) { error.textContent = 'أدخل سعرًا صحيحًا.'; return }
    const selectedUnit = settings.measurementUnits.find((item) => item.id === unit)
    if ((!selectedUnit && (!existing || existing.unit !== unit))
      || (selectedUnit && !selectedUnit.isDefault && (!existing || existing.unit !== unit))) {
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
    <div class="settings-tabs" role="tablist" aria-label="إعدادات التطبيق">
      <button class="active" role="tab" aria-selected="true" data-settings-tab="currency">العملة</button>
      <button role="tab" aria-selected="false" data-settings-tab="system">النظام</button>
      <button role="tab" aria-selected="false" data-settings-tab="backup">نسخ احتياطي</button>
      <button role="tab" aria-selected="false" data-settings-tab="preferences">التفضيلات</button>
      <button role="tab" aria-selected="false" data-settings-tab="account">الحساب</button>
    </div>
    <div id="settings-content"></div>`)
  element.querySelector('.modal-close')!.addEventListener('click', () => element.remove())
  const content = element.querySelector<HTMLElement>('#settings-content')!
  const renderTab = (tab: 'currency' | 'system' | 'backup' | 'preferences' | 'account') => {
    element.querySelectorAll<HTMLButtonElement>('[data-settings-tab]').forEach((button) => {
      const selected = button.dataset.settingsTab === tab
      button.classList.toggle('active', selected)
      button.setAttribute('aria-selected', String(selected))
    })
    if (tab === 'currency') renderCurrencySettings(content, element)
    if (tab === 'system') renderSystemSettings(content)
    if (tab === 'backup') renderBackupSettings(content)
    if (tab === 'preferences') renderPreferencesSettings(content)
    if (tab === 'account') renderAccountSettings(content)
  }
  element.querySelectorAll<HTMLButtonElement>('[data-settings-tab]').forEach((button) => {
    button.addEventListener('click', () =>
      renderTab(button.dataset.settingsTab as 'currency' | 'system' | 'backup' | 'preferences' | 'account'))
  })
  renderTab('currency')
}

function renderPreferencesSettings(content: HTMLElement) {
  const profile = safeCompanyProfile(settings.companyProfile)
  let contacts = profile.contacts
  content.innerHTML = `
    <section class="settings-page">
      <div class="settings-subtabs" role="tablist" aria-label="تبويبات التفضيلات">
        <button class="active" type="button" role="tab" aria-selected="true" data-preference-tab="company">بيانات الشركة</button>
        <button type="button" role="tab" aria-selected="false" data-preference-tab="units">وحدات القياس</button>
      </div>
      <div id="company-preferences-panel">
      <form id="company-profile-form" class="settings-form">
        <section class="settings-section">
          <div class="settings-section-heading">
            <h2>بيانات الشركة</h2>
            <p>تُستخدم هذه البيانات لتعريف شركتك في إعدادات التطبيق وتصدير الفواتير.</p>
          </div>
          <div class="settings-fields">
            <label>اسم الشركة
              <input name="companyName" maxlength="100" value="${escapeHtml(profile.name)}" placeholder="شركة النور التجارية">
            </label>
            <label>النشاط التجاري الذي تقدمه الشركة
              <textarea class="company-offerings-field" name="companyOfferings" maxlength="300" rows="1" placeholder="التجارة العامة والتوزيع">${escapeHtml(profile.offerings)}</textarea>
            </label>
            <label>العنوان
              <input name="companyAddress" maxlength="200" value="${escapeHtml(profile.address)}" placeholder="عنوان الشركة">
            </label>
            <label>تفاصيل الشركة
              <textarea name="companyDetails" maxlength="500" rows="3" placeholder="نبذة أو تفاصيل إضافية">${escapeHtml(profile.details)}</textarea>
            </label>
          </div>
        </section>
        <section class="settings-section">
          <div class="settings-section-heading">
            <h2>هواتف التواصل الخاصة بالشركة</h2>
            <p>أضف حتى 3 أرقام، مع اسم صاحب كل رقم.</p>
          </div>
          <div id="company-contacts" class="settings-contact-list"></div>
          <button class="secondary-button settings-add-contact" id="add-company-contact" type="button">إضافة هاتف</button>
        </section>
        <p class="settings-status" id="company-profile-status" role="status" aria-live="polite"></p>
        <button class="primary-button" id="save-company-profile" type="submit">حفظ بيانات الشركة</button>
      </form>
      </div>
      <div id="measurement-units-preferences-panel" hidden></div>
    </section>`

  const list = content.querySelector<HTMLElement>('#company-contacts')!
  const addButton = content.querySelector<HTMLButtonElement>('#add-company-contact')!
  const status = content.querySelector<HTMLElement>('#company-profile-status')!
  const renderContacts = () => {
    list.innerHTML = contacts.map((contact, index) => `
      <div class="settings-contact-row" data-contact-index="${index}">
        <label>الاسم
          <input data-contact-name="${index}" maxlength="60" value="${escapeHtml(contact.name)}" placeholder="اسم الشخص">
        </label>
        <label>رقم الهاتف
          <input data-contact-phone="${index}" type="tel" inputmode="tel" maxlength="30" value="${escapeHtml(contact.phone)}" placeholder="رقم الهاتف">
        </label>
        <button class="text-button settings-remove-contact" type="button" data-remove-contact="${index}" aria-label="إزالة رقم التواصل">إزالة</button>
      </div>`).join('')
    addButton.disabled = contacts.length >= 3
  }
  renderContacts()
  addButton.addEventListener('click', () => {
    if (contacts.length >= 3) return
    contacts = [...contacts, { name: '', phone: '' }]
    renderContacts()
    list.querySelector<HTMLInputElement>(`[data-contact-name="${contacts.length - 1}"]`)?.focus()
  })
  list.addEventListener('input', (event) => {
    if (!(event.target instanceof HTMLInputElement)) return
    const index = Number(event.target.dataset.contactName ?? event.target.dataset.contactPhone)
    if (!Number.isInteger(index) || !contacts[index]) return
    if (event.target.dataset.contactName !== undefined) contacts[index].name = event.target.value
    if (event.target.dataset.contactPhone !== undefined) contacts[index].phone = event.target.value
  })
  list.addEventListener('click', (event) => {
    if (!(event.target instanceof Element)) return
    const removeButton = event.target.closest<HTMLButtonElement>('[data-remove-contact]')
    if (!removeButton) return
    const index = Number(removeButton.dataset.removeContact)
    if (!Number.isInteger(index) || !contacts[index]) return
    contacts = contacts.filter((_, contactIndex) => contactIndex !== index)
    renderContacts()
  })
  content.querySelector<HTMLFormElement>('#company-profile-form')!.addEventListener('submit', async (event) => {
    event.preventDefault()
    const user = currentUser
    const ownerId = dataUserId
    if (!user || !ownerId) return
    const form = event.currentTarget as HTMLFormElement
    const incompleteContact = contacts.some((contact) =>
      Boolean(contact.name.trim()) !== Boolean(contact.phone.trim()))
    if (incompleteContact) {
      status.textContent = 'أدخل اسم ورقم هاتف لكل شخص، أو احذف جهة الاتصال غير المكتملة.'
      status.classList.add('is-error')
      return
    }
    const formData = new FormData(form)
    const companyProfile = safeCompanyProfile({
      name: String(formData.get('companyName') || '').trim(),
      offerings: String(formData.get('companyOfferings') || '').trim(),
      details: String(formData.get('companyDetails') || '').trim(),
      address: String(formData.get('companyAddress') || '').trim(),
      contacts: contacts
        .filter((contact) => contact.name.trim() && contact.phone.trim())
        .map((contact) => ({ name: contact.name.trim(), phone: contact.phone.trim() })),
    })
    const submit = content.querySelector<HTMLButtonElement>('#save-company-profile')!
    submit.disabled = true
    status.classList.remove('is-error')
    status.textContent = 'جارٍ حفظ بيانات الشركة...'
    try {
      await setDoc(doc(db, 'users', ownerId), { companyProfile }, { merge: true })
      if (currentUser?.uid !== user.uid || dataUserId !== ownerId) return
      settings = { ...settings, companyProfile }
      try {
        saveCachedSettings(ownerId, settings)
        status.textContent = 'تم حفظ بيانات الشركة بنجاح.'
      } catch (cacheError) {
        console.error('Company profile was saved remotely but the local cache could not be updated.', cacheError)
        status.textContent = 'حُفظت بيانات الشركة على الحساب، لكن تعذر تحديث النسخة المحلية.'
        status.classList.add('is-error')
      }
    } catch (saveError) {
      status.textContent = friendlyError(saveError)
      status.classList.add('is-error')
    } finally {
      submit.disabled = false
    }
  })
  const companyPanel = content.querySelector<HTMLElement>('#company-preferences-panel')!
  const unitsPanel = content.querySelector<HTMLElement>('#measurement-units-preferences-panel')!
  content.querySelectorAll<HTMLButtonElement>('[data-preference-tab]').forEach((tab) => {
    tab.addEventListener('click', () => {
      const showUnits = tab.dataset.preferenceTab === 'units'
      content.querySelectorAll<HTMLButtonElement>('[data-preference-tab]').forEach((item) => {
        const selected = item === tab
        item.classList.toggle('active', selected)
        item.setAttribute('aria-selected', String(selected))
      })
      companyPanel.hidden = showUnits
      unitsPanel.hidden = !showUnits
      if (showUnits) renderMeasurementUnitsSettings(unitsPanel)
    })
  })
}

async function persistMeasurementUnits(units: MeasurementUnit[], status: HTMLElement): Promise<boolean> {
  const user = currentUser
  const ownerId = dataUserId
  if (!user || !ownerId) {
    status.textContent = 'تعذر تحديد الحساب لحفظ وحدات القياس.'
    status.classList.add('is-error')
    return false
  }
  status.classList.remove('is-error')
  status.textContent = 'جارٍ حفظ وحدات القياس...'
  try {
    await setDoc(doc(db, 'users', ownerId), { measurementUnits: units }, { merge: true })
  } catch (saveError) {
    console.error('Failed to save measurement units:', saveError)
    status.textContent = friendlyError(saveError)
    status.classList.add('is-error')
    return false
  }
  if (currentUser?.uid !== user.uid || dataUserId !== ownerId) return false
  settings = { ...settings, measurementUnits: normalizeMeasurementUnits(units) }
  try {
    saveCachedSettings(ownerId, settings)
    status.textContent = 'تم حفظ وحدات القياس.'
  } catch (cacheError) {
    console.error('Measurement units were saved remotely but the local cache could not be updated.', cacheError)
    status.textContent = 'حُفظت وحدات القياس على الحساب، لكن تعذر تحديث النسخة المحلية.'
    status.classList.add('is-error')
  }
  updateServicesShell()
  return true
}

function renderMeasurementUnitsSettings(content: HTMLElement) {
  let units = normalizeMeasurementUnits(settings.measurementUnits)
  let editingId: string | null = null
  content.innerHTML = `
    <div class="settings-page">
      <section class="settings-section">
        <div class="settings-section-heading">
          <h2>إدارة وحدات القياس</h2>
          <p>اختر الوحدات التي تظهر عند إضافة خدمة. تغيير اسم الوحدة يحدّث الخدمات، ولا يغيّر الاسم المحفوظ في الفواتير السابقة.</p>
        </div>
        <form id="measurement-unit-form" class="measurement-unit-form">
          <label>اسم الوحدة
            <input name="name" maxlength="15" required placeholder="مثال: صندوق">
          </label>
          <label class="measurement-unit-form-default">
            <input name="isDefault" type="checkbox" checked>
            <span>إظهارها في قائمة إضافة الخدمات</span>
          </label>
          <div class="measurement-unit-form-actions">
            <button class="primary-button" type="submit" id="save-measurement-unit">إضافة الوحدة</button>
            <button class="secondary-button" type="button" id="cancel-measurement-unit-edit" hidden>إلغاء التعديل</button>
          </div>
        </form>
        <p class="settings-status" id="measurement-unit-status" role="status" aria-live="polite"></p>
      </section>
      <section class="settings-section">
        <div class="settings-section-heading">
          <h2>الوحدات المسجلة</h2>
          <p>الوحدات الافتراضية لا يمكن حذفها. أزل ارتباط الوحدة بالخدمات قبل حذف وحدة مخصصة.</p>
        </div>
        <div class="measurement-unit-list" id="measurement-unit-list"></div>
      </section>
    </div>`

  const form = content.querySelector<HTMLFormElement>('#measurement-unit-form')!
  const nameInput = form.querySelector<HTMLInputElement>('input[name="name"]')!
  const defaultInput = form.querySelector<HTMLInputElement>('input[name="isDefault"]')!
  const submit = form.querySelector<HTMLButtonElement>('#save-measurement-unit')!
  const cancelEdit = form.querySelector<HTMLButtonElement>('#cancel-measurement-unit-edit')!
  const status = content.querySelector<HTMLElement>('#measurement-unit-status')!
  const list = content.querySelector<HTMLElement>('#measurement-unit-list')!
  const renderList = () => {
    list.innerHTML = units.map((unit) => {
      const inUse = workServices.some((service) => service.unit === unit.id)
      const cannotDelete = unit.isSystem || unit.isDefault || inUse
      const deleteReason = unit.isSystem
        ? 'وحدات النظام لا تحذف.'
        : unit.isDefault
          ? 'أوقف ظهور الوحدة في إضافة الخدمات قبل حذفها.'
          : inUse
            ? 'لا يمكن حذف وحدة مرتبطة بخدمة.'
            : 'حذف الوحدة'
      return `
        <article class="measurement-unit-row">
          <div class="measurement-unit-info">
            <strong>${escapeHtml(unit.name)}</strong>
            <small>${unit.isSystem ? 'وحدة أساسية' : `المعرّف: ${escapeHtml(unit.id)}`}</small>
          </div>
          <div class="measurement-unit-controls">
            <label class="measurement-unit-toggle">
              <input type="checkbox" data-unit-default="${escapeHtml(unit.id)}" ${unit.isDefault ? 'checked' : ''}>
              <span>تظهر عند إضافة خدمة</span>
            </label>
            <div class="measurement-unit-actions">
              <button class="secondary-button" type="button" data-edit-unit="${escapeHtml(unit.id)}">تعديل الاسم</button>
              <button class="danger-button" type="button" data-delete-unit="${escapeHtml(unit.id)}" title="${deleteReason}" ${cannotDelete ? 'disabled' : ''}>حذف</button>
            </div>
          </div>
        </article>`
    }).join('')
  }
  const resetForm = () => {
    editingId = null
    form.reset()
    defaultInput.checked = true
    submit.textContent = 'إضافة الوحدة'
    cancelEdit.hidden = true
  }
  const normalizeName = (name: string) => name
    .normalize('NFKC')
    .trim()
    .replace(/\s+/g, ' ')
    .toLocaleLowerCase('ar')

  renderList()
  cancelEdit.addEventListener('click', resetForm)
  form.addEventListener('submit', async (event) => {
    event.preventDefault()
    const name = nameInput.value.trim().replace(/\s+/g, ' ')
    if (!name) {
      status.textContent = 'أدخل اسم وحدة القياس.'
      status.classList.add('is-error')
      return
    }
    if (name.length > 15) {
      status.textContent = 'يجب ألا يتجاوز اسم الوحدة 15 حرفًا.'
      status.classList.add('is-error')
      return
    }
    if (units.some((unit) => unit.id !== editingId && normalizeName(unit.name) === normalizeName(name))) {
      status.textContent = 'هذه الوحدة مسجلة بالفعل.'
      status.classList.add('is-error')
      return
    }
    const existing = editingId ? units.find((unit) => unit.id === editingId) : undefined
    const nextUnits = existing
      ? units.map((unit) => unit.id === existing.id ? { ...unit, name } : unit)
      : [...units, {
        id: crypto.randomUUID(),
        name,
        isDefault: defaultInput.checked,
        isSystem: false,
      }]
    submit.disabled = true
    const saved = await persistMeasurementUnits(nextUnits, status)
    submit.disabled = false
    if (!saved) return
    units = normalizeMeasurementUnits(nextUnits)
    resetForm()
    renderList()
  })
  list.addEventListener('click', async (event) => {
    if (!(event.target instanceof Element)) return
    const editButton = event.target.closest<HTMLButtonElement>('[data-edit-unit]')
    if (editButton) {
      const unit = units.find((item) => item.id === editButton.dataset.editUnit)
      if (!unit) return
      editingId = unit.id
      nameInput.value = unit.name
      defaultInput.checked = unit.isDefault
      submit.textContent = 'حفظ الاسم'
      cancelEdit.hidden = false
      nameInput.focus()
      return
    }
    const deleteButton = event.target.closest<HTMLButtonElement>('[data-delete-unit]')
    if (!deleteButton || deleteButton.disabled) return
    const unit = units.find((item) => item.id === deleteButton.dataset.deleteUnit)
    if (!unit) return
    const nextUnits = units.filter((item) => item.id !== unit.id)
    deleteButton.disabled = true
    const saved = await persistMeasurementUnits(nextUnits, status)
    if (saved) {
      units = nextUnits
      renderList()
    } else {
      deleteButton.disabled = false
    }
  })
  list.addEventListener('change', async (event) => {
    if (!(event.target instanceof HTMLInputElement)) return
    const toggle = event.target.closest<HTMLInputElement>('[data-unit-default]')
    if (!toggle) return
    const unit = units.find((item) => item.id === toggle.dataset.unitDefault)
    if (!unit || toggle.checked === unit.isDefault) return
    if (!toggle.checked && units.filter((item) => item.isDefault).length <= 1) {
      status.textContent = 'يجب إبقاء وحدة واحدة على الأقل ظاهرة عند إضافة الخدمات.'
      status.classList.add('is-error')
      renderList()
      return
    }
    toggle.disabled = true
    const nextUnits = units.map((item) =>
      item.id === unit.id ? { ...item, isDefault: toggle.checked } : item)
    const saved = await persistMeasurementUnits(nextUnits, status)
    if (saved) units = normalizeMeasurementUnits(nextUnits)
    renderList()
  })
}

function renderAccountSettings(content: HTMLElement) {
  const user = currentUser
  if (!user) return
  const ownerId = dataUserId
  const initialProfile = accountProfileReady ? accountProfile : accountProfileForUser(user, null)
  content.innerHTML = `
    <section class="settings-page">
      <section class="settings-section">
        <div class="settings-section-heading">
          <h2>بيانات الحساب</h2>
          <p>حدّث بياناتك الشخصية المرتبطة بهذا الحساب.</p>
        </div>
        <form id="account-profile-form" class="settings-form">
          <div class="settings-fields account-profile-fields">
            <label>الاسم أو اللقب
              <input name="name" maxlength="60" value="${escapeHtml(initialProfile.name)}" autocomplete="name" required>
            </label>
            <label>رقم الهاتف
              <input name="phone" type="tel" inputmode="tel" maxlength="30" value="${escapeHtml(initialProfile.phone)}" autocomplete="tel">
            </label>
            <label>البريد الإلكتروني
              <input type="email" value="${escapeHtml(user.email || '')}" readonly aria-describedby="account-email-note">
              <small id="account-email-note">البريد الإلكتروني مرتبط بتسجيل الدخول ولا يمكن تغييره من هنا.</small>
            </label>
          </div>
          <p class="settings-status" id="account-profile-status" role="status" aria-live="polite"></p>
          <button class="primary-button" id="save-account-profile" type="submit">حفظ بيانات الحساب</button>
        </form>
      </section>
      <section class="settings-section">
        <div class="settings-section-heading">
          <h2>تغيير كلمة المرور</h2>
          <p>أدخل كلمة المرور الحالية، ثم كلمة المرور الجديدة مرتين.</p>
        </div>
        <form id="account-password-form" class="settings-form">
          <div class="settings-fields">
            <label>كلمة المرور الحالية
              <input name="currentPassword" type="password" autocomplete="current-password" required>
            </label>
            <label>كلمة المرور الجديدة
              <input name="newPassword" type="password" autocomplete="new-password" minlength="6" required>
            </label>
            <label>تأكيد كلمة المرور الجديدة
              <input name="confirmPassword" type="password" autocomplete="new-password" minlength="6" required>
            </label>
          </div>
          <p class="settings-status" id="account-password-status" role="status" aria-live="polite"></p>
          <button class="primary-button" id="change-account-password" type="submit">تغيير كلمة المرور</button>
        </form>
      </section>
      </form>
      </div>
      <div id="measurement-units-preferences-panel" hidden></div>
    </section>`

  const profileForm = content.querySelector<HTMLFormElement>('#account-profile-form')!
  const profileStatus = content.querySelector<HTMLElement>('#account-profile-status')!
  const profileReference = doc(db, 'users', ownerId, 'accountProfiles', user.uid)

  profileForm.addEventListener('submit', async (event) => {
    event.preventDefault()
    const form = event.currentTarget as HTMLFormElement
    const formData = new FormData(form)
    const profile: AccountProfile = {
      name: String(formData.get('name') || '').trim(),
      phone: String(formData.get('phone') || '').trim(),
    }
    if (!profile.name) {
      profileStatus.textContent = 'أدخل الاسم أو اللقب قبل الحفظ.'
      profileStatus.classList.add('is-error')
      return
    }
    const submit = content.querySelector<HTMLButtonElement>('#save-account-profile')!
    submit.disabled = true
    profileStatus.classList.remove('is-error')
    profileStatus.textContent = 'جارٍ حفظ بيانات الحساب...'
    try {
      await setDoc(profileReference, profile, { merge: true })
      if (currentUser?.uid !== user.uid || dataUserId !== ownerId) return
      accountProfile = profile
      accountProfileReady = true
      profileStatus.textContent = 'تم حفظ بيانات الحساب بنجاح.'
    } catch (saveError) {
      profileStatus.textContent = friendlyError(saveError)
      profileStatus.classList.add('is-error')
    } finally {
      submit.disabled = false
    }
  })

  const passwordForm = content.querySelector<HTMLFormElement>('#account-password-form')!
  const passwordStatus = content.querySelector<HTMLElement>('#account-password-status')!
  passwordForm.addEventListener('submit', async (event) => {
    event.preventDefault()
    const currentPassword = String(new FormData(passwordForm).get('currentPassword') || '')
    const newPassword = String(new FormData(passwordForm).get('newPassword') || '')
    const confirmPassword = String(new FormData(passwordForm).get('confirmPassword') || '')
    if (newPassword !== confirmPassword) {
      passwordStatus.textContent = 'كلمتا المرور الجديدتان غير متطابقتين.'
      passwordStatus.classList.add('is-error')
      return
    }
    if (newPassword === currentPassword) {
      passwordStatus.textContent = 'اختر كلمة مرور جديدة مختلفة عن الحالية.'
      passwordStatus.classList.add('is-error')
      return
    }
    if (!user.email || !user.providerData.some((provider) => provider.providerId === 'password')) {
      passwordStatus.textContent = 'تغيير كلمة المرور غير متاح لهذا النوع من الحسابات.'
      passwordStatus.classList.add('is-error')
      return
    }
    const submit = content.querySelector<HTMLButtonElement>('#change-account-password')!
    submit.disabled = true
    passwordStatus.classList.remove('is-error')
    passwordStatus.textContent = 'جارٍ تحديث كلمة المرور...'
    try {
      const credential = EmailAuthProvider.credential(user.email, currentPassword)
      await reauthenticateWithCredential(user, credential)
      if (currentUser?.uid !== user.uid) return
      await updatePassword(user, newPassword)
      passwordForm.reset()
      passwordStatus.textContent = 'تم تغيير كلمة المرور بنجاح.'
    } catch (passwordError) {
      passwordStatus.textContent = accountPasswordError(passwordError)
      passwordStatus.classList.add('is-error')
    } finally {
      submit.disabled = false
    }
  })
}

function accountPasswordError(error: unknown): string {
  const code = typeof error === 'object' && error && 'code' in error
    ? String((error as { code: string }).code)
    : ''
  if (code === 'auth/wrong-password' || code === 'auth/invalid-credential') {
    return 'كلمة المرور الحالية غير صحيحة.'
  }
  if (code === 'auth/weak-password') return 'كلمة المرور الجديدة ضعيفة؛ استخدم كلمة مرور أقوى.'
  if (code === 'auth/requires-recent-login') return 'انتهت صلاحية التحقق؛ سجّل الدخول مجددًا ثم حاول مرة أخرى.'
  if (code === 'auth/network-request-failed') return 'تعذر الاتصال بالشبكة؛ تحقق من اتصالك وحاول مجددًا.'
  return friendlyError(error)
}

function renderCurrencySettings(content: HTMLElement, element: HTMLElement) {
  content.innerHTML = `
    <h2>العملة</h2>
    <label class="switch-row"><span>تفعيل الليرة السورية</span><input id="local-currency-enabled" type="checkbox" ${settings.syriaEnabled ? 'checked' : ''}><i></i></label>
    <div id="currency-fields" class="${settings.syriaEnabled ? '' : 'hidden'}">
      <label>سعر الصرف<input id="exchange-rate" type="number" min="0.000001" step="0.000001" value="${settings.exchangeRate || ''}" placeholder="15000"><small>1 $ = عدد الليرات</small></label>
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
  const logoutButton = content.querySelector<HTMLButtonElement>('#logout')!
  logoutButton.addEventListener('click', async () => {
    logoutButton.disabled = true
    try {
      await signOut(auth)
    } catch (logoutError) {
      logoutButton.disabled = false
      showToast(friendlyError(logoutError))
    }
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
        companyProfile: settings.companyProfile,
        measurementUnits: settings.measurementUnits,
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
  customerNeighborhood: string
  workshopName: string
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

function drawCompanyBranding(
  context: CanvasRenderingContext2D,
  options: {
    x: number
    nameY: number
    contactY: number
    maxWidth: number
    align?: CanvasTextAlign
    nameFont?: string
    contactFont?: string
    nameColor?: string
    contactColor?: string
  },
) {
  const { name, contactLine } = currentCompanyBranding()
  if (!name && !contactLine) return
  context.save()
  context.direction = 'rtl'
  context.textAlign = options.align || 'center'
  if (name) {
    context.fillStyle = options.nameColor || '#007d79'
    context.font = options.nameFont || '800 24px Cairo, sans-serif'
    context.fillText(name, options.x, options.nameY, options.maxWidth)
  }
  if (contactLine) {
    context.fillStyle = options.contactColor || '#718096'
    context.font = options.contactFont || '700 12px Cairo, sans-serif'
    context.fillText(contactLine, options.x, options.contactY, options.maxWidth)
  }
  context.restore()
}

function drawInvoiceCompanyBranding(context: CanvasRenderingContext2D, width: number) {
  const company = currentCompanyBranding()
  const lines = [
    { text: company.name, font: '800 20px "Cairo", sans-serif', size: 20 },
    { text: company.offerings, font: '800 18px "Cairo", sans-serif', size: 18 },
    { text: company.contactDetails, font: '800 16px "Cairo", sans-serif', size: 16 },
  ].filter((line) => line.text)
  if (!lines.length) return null

  const lineHeight = 34
  const headerCenterY = 74
  const firstLineY = headerCenterY - ((lines.length - 1) * lineHeight) / 2
  context.save()
  context.direction = 'rtl'
  context.textAlign = 'center'
  context.textBaseline = 'middle'
  lines.forEach((line, index) => {
    context.fillStyle = '#111111'
    context.font = line.font
    context.fillText(line.text, width / 2, firstLineY + index * lineHeight, width - 80)
  })
  const lastLineY = firstLineY + (lines.length - 1) * lineHeight
  const dividerY = lastLineY + lines[lines.length - 1].size / 2 + 20
  context.strokeStyle = '#007d79'
  context.lineWidth = 2
  context.beginPath()
  context.moveTo(40, dividerY)
  context.lineTo(width - 40, dividerY)
  context.stroke()
  context.restore()
  return dividerY
}

function invoiceCurrencyLabel(currencyCode: string) {
  return currencyCode === 'USD' ? USD_CURRENCY_SYMBOL : currencyCode
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
  return String(number)
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
  customerNeighborhood?: string
}) {
  const segments: Array<{ text: string; red: boolean }> = []
  const customerName = details.customerName?.trim()
  const customerPhone = details.customerPhone?.trim()
  const customerAddress = details.customerAddress?.trim()
  const customerNeighborhood = details.customerNeighborhood?.trim()
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
  if (customerNeighborhood) {
    if (segments.length) segments.push({ text: ' | ', red: false })
    segments.push(
      { text: 'الحي: ', red: false },
      { text: customerNeighborhood, red: true },
    )
  }
  return segments
}

function workshopTeacherSegments(workshopName?: string, responsibleTeacherName?: string) {
  const workshop = workshopName?.trim()
  const teacher = responsibleTeacherName?.trim()
  const segments: Array<{ text: string; red: boolean }> = []
  if (workshop) {
    segments.push(
      { text: 'اسم الورشة: ', red: false },
      { text: workshop, red: true },
    )
  }
  if (workshop && teacher) segments.push({ text: ' | ', red: false })
  if (teacher) {
    segments.push(
      { text: 'المعلم المسؤول عن التنفيذ: ', red: false },
      { text: teacher, red: true },
    )
  }
  return segments
}

function drawDetailSegments(
  context: CanvasRenderingContext2D,
  width: number,
  y: number,
  segments: Array<{ text: string; red: boolean }>,
  boldRedValues = false,
) {
  if (!segments.length) return
  context.save()
  const fontForSegment = (segment: { text: string; red: boolean }) =>
    `${segment.red && boldRedValues ? '800' : '600'} 14px "Cairo", sans-serif`
  const detailWidth = segments.reduce((total, segment) => {
    context.font = fontForSegment(segment)
    return total + context.measureText(segment.text).width
  }, 0)
  const detailScale = Math.min(1, 760 / detailWidth)
  context.translate(width / 2, 0)
  context.scale(detailScale, 1)
  let detailX = detailWidth / 2
  context.direction = 'rtl'
  context.textAlign = 'right'
  segments.forEach((segment) => {
    context.font = fontForSegment(segment)
    context.fillStyle = segment.red ? '#c62828' : '#000000'
    context.fillText(segment.text, detailX, y)
    detailX -= context.measureText(segment.text).width
  })
  context.restore()
}

function drawCustomerDetails(
  context: CanvasRenderingContext2D,
  width: number,
  y: number,
  details: { customerName?: string; customerPhone?: string; customerAddress?: string; customerNeighborhood?: string },
) {
  drawDetailSegments(context, width, y, customerDetailsSegments(details))
}

async function exportServicesToImage(
  button: HTMLButtonElement,
  imageScale: ImageExportScale,
  rows: ExportServiceRow[],
  options: { customerName?: string; customerPhone?: string; customerAddress?: string; exportNote?: string; previewOnly?: boolean } = {},
): Promise<boolean | string[]> {
  if (!rows.length) {
    showToast('لا توجد خدمات محددة للتصدير.')
    return false
  }
  if (!options.previewOnly) button.disabled = true
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
    const exportNote = options.exportNote?.trim() || ''
    const companyBranding = currentCompanyBranding()

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
      drawCompanyBranding(context, {
        x: width / 2,
        nameY: 70,
        contactY: 96,
        maxWidth: tableWidth,
        nameFont: '800 30px "Cairo", sans-serif',
        contactFont: '700 12px "Cairo", sans-serif',
      })

      context.fillStyle = '#203044'
      context.font = '800 20px "Cairo", sans-serif'
      context.fillText('قائمة أسعار الخدمات', width / 2, 125)

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
        'تنويه: هذه قائمة بأسعار الخدمات، وليست فاتورةً عن أعمال منفذة.',
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
        context.fillText(currencyText === '$' ? formatUsdAmount(exportPrice) : `${money(exportPrice)} ${currencyText}`, 115, y + 27)
      }

      const noteLines = exportNote && pageIndex === pageCount - 1
        ? wrapCanvasText(context, `ملاحظة: ${exportNote}`, tableWidth).slice(0, 2)
        : []
      if (noteLines.length) {
        context.fillStyle = '#203044'
        context.textAlign = 'center'
        context.font = '600 11px "Cairo", sans-serif'
        const noteStartY = 1099 - (noteLines.length - 1) * 14
        noteLines.forEach((line, index) => context.fillText(line, width / 2, noteStartY + index * 14, tableWidth))
      }

      const footerY = noteLines.length ? 1125 : 1115
      if (companyBranding.name) {
        context.fillStyle = '#203044'
        context.textAlign = 'center'
        context.font = '800 18px "Cairo", sans-serif'
        context.fillText(companyBranding.name, width / 2, footerY, tableWidth)
      }
      context.fillStyle = '#007d79'
      context.textAlign = 'center'
      context.font = '800 18px "Cairo", sans-serif'
      context.fillText('نسعد بخدمتكم', width / 2, companyBranding.name ? footerY + 28 : footerY)
      if (pageCount > 1) {
        context.fillStyle = '#718096'
        context.textAlign = 'center'
        context.font = '600 14px "Cairo", sans-serif'
        const pageNumberY = companyBranding.name ? footerY + 52 : footerY + 30
        context.fillText(`صفحة ${pageIndex + 1} من ${pageCount}`, width / 2, pageNumberY)
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
      link.download = `قائمة-الخدمات-${imageScale === highQualityImageScale ? 'فائقة-الجودة-' : ''}${exportDate}${suffix}.png`
      document.body.append(link)
      window.setTimeout(() => {
        link.click()
        link.remove()
        URL.revokeObjectURL(url)
      }, pageIndex * 350)
    }
    if (options.previewOnly) return previewUrls
    showToast(pageCount > 1 ? `تم تصدير ${pageCount} صفحات PNG.` : 'تم تصدير قائمة الخدمات كصورة PNG.')
    return true
  } catch (error) {
    console.error('Failed to export services image:', error)
    showToast('تعذر تصدير الصورة. حاول مجددًا.')
    return false
  } finally {
    if (!options.previewOnly) button.disabled = false
  }
}

function openServicesExportDialog(rows: ExportServiceRow[], previousWindow: HTMLDivElement) {
  if (!rows.length) {
    showToast('لا توجد خدمات محددة للتصدير.')
    return
  }
  const element = modal(`
    <button class="modal-close" aria-label="إغلاق">${svg('close')}</button>
    <p class="eyebrow">تجهيز قائمة الخدمات</p>
    <h2>معلومات التصدير والمعاينة</h2>
    <div class="services-export-fields">
      <label>اسم الزبون
        <input id="export-customer-name" type="text" maxlength="20" placeholder="اسم الزبون">
      </label>
      <label>رقم هاتف الزبون
        <input id="export-customer-phone" type="tel" maxlength="15" placeholder="رقم الهاتف">
      </label>
      <label>عنوان الزبون
        <input id="export-customer-address" type="text" maxlength="15" placeholder="عنوان الزبون">
      </label>
      <label>ملاحظة
        <input id="export-customer-note" type="text" maxlength="100" placeholder="ملاحظة اختيارية">
      </label>
    </div>
    <fieldset class="invoice-export-format services-export-format">
      <legend>نوع التصدير</legend>
      <label><input type="radio" name="services-export-format" value="image-high" checked> صورة فائقة</label>
      <label><input type="radio" name="services-export-format" value="image"> صورة عادية</label>
    </fieldset>
    <div class="services-export-preview">
      <p class="services-export-preview-status" aria-live="polite">جارٍ إعداد المعاينة...</p>
      <div class="export-preview-wrap">
        <img id="export-preview-image" alt="معاينة قائمة أسعار الخدمات">
      </div>
    </div>
    <div class="services-export-actions">
      <button class="secondary-button" id="cancel-services-export" type="button">العودة للخدمات</button>
      <button class="primary-button" id="confirm-services-export" type="button">تصدير</button>
    </div>
  `, { preserveExisting: true })
  element.querySelector<HTMLElement>('.modal')!.classList.add('services-export-modal')
  const closeDialog = () => {
    element.remove()
    previousWindow.hidden = false
  }
  element.addEventListener('click', (event) => {
    if (event.target !== element) return
    event.stopImmediatePropagation()
    closeDialog()
  }, true)
  element.querySelector('.modal-close')!.addEventListener('click', closeDialog)
  const nameInput = element.querySelector<HTMLInputElement>('#export-customer-name')!
  const phoneInput = element.querySelector<HTMLInputElement>('#export-customer-phone')!
  const addressInput = element.querySelector<HTMLInputElement>('#export-customer-address')!
  const noteInput = element.querySelector<HTMLInputElement>('#export-customer-note')!
  const preview = element.querySelector<HTMLImageElement>('#export-preview-image')!
  const previewStatus = element.querySelector<HTMLElement>('.services-export-preview-status')!
  const confirmButton = element.querySelector<HTMLButtonElement>('#confirm-services-export')!
  const formatInputs = [...element.querySelectorAll<HTMLInputElement>('input[name="services-export-format"]')]
  let previewVersion = 0
  let previewUpdateTimer: number | undefined
  const exportDetails = () => ({
    customerName: nameInput.value,
    customerPhone: phoneInput.value,
    customerAddress: addressInput.value,
    exportNote: noteInput.value,
  })

  const refreshPreview = async () => {
    preview.classList.add('is-loading')
    previewStatus.textContent = 'جارٍ تحديث المعاينة...'
    const version = ++previewVersion
    const result = await exportServicesToImage(confirmButton, 1, rows, { ...exportDetails(), previewOnly: true })
    if (version !== previewVersion) return
    if (Array.isArray(result) && result[0]) {
      preview.src = result[0]
      previewStatus.textContent = 'تُعرض المعاينة بالصورة العادية؛ وسيُستخدم نوع التصدير المحدد عند التصدير.'
    } else {
      previewStatus.textContent = 'تعذر إعداد المعاينة.'
    }
    preview.classList.remove('is-loading')
  }

  const schedulePreview = () => {
    if (previewUpdateTimer !== undefined) window.clearTimeout(previewUpdateTimer)
    previewUpdateTimer = window.setTimeout(() => {
      previewUpdateTimer = undefined
      void refreshPreview()
    }, 180)
  }
  element.querySelector('#cancel-services-export')!.addEventListener('click', closeDialog)
  ;[nameInput, phoneInput, addressInput, noteInput].forEach((input) =>
    input.addEventListener('input', schedulePreview))
  confirmButton.addEventListener('click', async () => {
    const selectedFormat = formatInputs.find((input) => input.checked)?.value
    if (selectedFormat !== 'image-high' && selectedFormat !== 'image') {
      showToast('اختر نوع التصدير.')
      return
    }
    const details = exportDetails()
    const successful = await exportServicesToImage(
      confirmButton,
      selectedFormat === 'image-high' ? highQualityImageScale : 1,
      rows,
      details,
    )
    if (successful === true) closeDialog()
  })
  void refreshPreview()
}

const invoiceFinalPageCapacity = 18
const invoiceContinuationPageCapacity = 24

type InvoicePaymentCardData = {
  payment: InvoicePayment
  index: number
  sublabel: string
}

type InvoicePaymentDisplayRow = {
  cards: InvoicePaymentCardData[]
  height: number
}

type InvoiceSummaryPagePlan = {
  includeTotals: boolean
  includeFinancialTotals: boolean
  paymentRows: InvoicePaymentDisplayRow[]
}

function invoiceExportPayments(data: InvoiceExportData) {
  return (data.payments && data.payments.length
    ? data.payments
    : (data.upfrontPayment !== null && data.upfrontPayment > 0
      ? [{ amount: data.upfrontPayment, date: data.upfrontPaymentDate || '', note: '', createdAt: '' }]
      : [])).filter((payment) => payment.amount > 0)
}

function invoicePaymentDisplayRows(
  context: CanvasRenderingContext2D,
  payments: InvoicePayment[],
  totalWidth: number,
): InvoicePaymentDisplayRow[] {
  const cards = payments.map((payment, index) => ({
    payment,
    index,
    sublabel: [
      payment.date ? `التاريخ: ${payment.date}` : '',
      (payment.note || '').trim(),
    ].filter(Boolean).join(' — '),
  }))
  const rows: InvoicePaymentDisplayRow[] = []
  for (let start = 0; start < cards.length; start += 5) {
    const rowCards = cards.slice(start, start + 5)
    const cardGap = 8
    const cardWidth = (totalWidth - cardGap * (rowCards.length - 1)) / rowCards.length
    context.font = '600 8px "Cairo", sans-serif'
    const maxLines = rowCards.reduce((max, card) =>
      Math.max(max, wrapCanvasText(context, card.sublabel, cardWidth - 12).length), 0)
    rows.push({
      cards: rowCards,
      height: Math.max(44, 40 + maxLines * 10),
    })
  }
  return rows
}

function invoiceSummaryBlockHeight(
  includeTotals: boolean,
  includeFinancialTotals: boolean,
  hasPayments: boolean,
  paymentRows: InvoicePaymentDisplayRow[],
) {
  let height = 12
  if (includeTotals) {
    height += hasPayments ? 20 + 24 : 24 + 24
  }
  if (hasPayments && paymentRows.length > 0) {
    height += (includeTotals ? 4 : 0) + 18 + 4
    paymentRows.forEach((row, index) => {
      height += row.height + (index > 0 ? 4 : 0)
    })
  }
  if (includeFinancialTotals) {
    height += hasPayments ? 4 + 18 + 2 + 48 : 8 + 22 + 4 + 58
  }
  return height
}

function invoiceSummaryPagePlans(
  paymentRows: InvoicePaymentDisplayRow[],
  hasPayments: boolean,
  firstPageHeight: number,
  continuationPageHeight: number,
): InvoiceSummaryPagePlan[] {
  const fullHeight = invoiceSummaryBlockHeight(true, true, hasPayments, paymentRows)
  if (fullHeight <= firstPageHeight) {
    return [{ includeTotals: true, includeFinancialTotals: true, paymentRows }]
  }

  const pages: InvoiceSummaryPagePlan[] = []
  let rowIndex = 0
  while (rowIndex < paymentRows.length) {
    const includeTotals = pages.length === 0
    const maxHeight = (includeTotals ? firstPageHeight : continuationPageHeight) - 40
    const pageRows: InvoicePaymentDisplayRow[] = []
    while (rowIndex < paymentRows.length) {
      const candidateRows = [...pageRows, paymentRows[rowIndex]]
      const includeFinancialTotals = rowIndex === paymentRows.length - 1
      if (
        invoiceSummaryBlockHeight(includeTotals, includeFinancialTotals, hasPayments, candidateRows) > maxHeight
        && pageRows.length > 0
      ) {
        break
      }
      pageRows.push(paymentRows[rowIndex])
      rowIndex += 1
      if (
        invoiceSummaryBlockHeight(
          includeTotals,
          rowIndex === paymentRows.length,
          hasPayments,
          pageRows,
        ) > maxHeight
      ) break
    }
    pages.push({
      includeTotals,
      includeFinancialTotals: rowIndex === paymentRows.length,
      paymentRows: pageRows,
    })
  }
  return pages
}

function invoicePageRowCounts(
  totalRows: number,
  singlePageFinalCapacity: number,
  multiPageFinalCapacity: number,
) {
  if (totalRows === 0) return [0]
  if (totalRows <= singlePageFinalCapacity) return [totalRows]

  const pageRowCounts: number[] = []
  let remainingRows = totalRows
  while (remainingRows > invoiceContinuationPageCapacity) {
    pageRowCounts.push(invoiceContinuationPageCapacity)
    remainingRows -= invoiceContinuationPageCapacity
  }
  if (remainingRows > multiPageFinalCapacity) {
    pageRowCounts.push(remainingRows)
    pageRowCounts.push(0)
  } else {
    pageRowCounts.push(remainingRows)
  }
  return pageRowCounts
}

function drawInvoiceSummary(
  context: CanvasRenderingContext2D,
  data: InvoiceExportData,
  exportPayments: InvoicePayment[],
  summaryPage: InvoiceSummaryPagePlan,
  hasPayments: boolean,
  left: number,
  right: number,
  top: number,
) {
  const width = right - left
  const padding = 6
  const blockHeight = invoiceSummaryBlockHeight(
    summaryPage.includeTotals,
    summaryPage.includeFinancialTotals,
    hasPayments,
    summaryPage.paymentRows,
  )
  context.fillStyle = '#ffffff'
  context.fillRect(left, top, width, blockHeight)
  let y = top + padding

  if (summaryPage.includeTotals) {
    const quantityTitleHeight = hasPayments ? 20 : 24
    context.fillStyle = '#007d79'
    context.fillRect(left + padding, y, width - padding * 2, quantityTitleHeight)
    context.textAlign = 'center'
    context.fillStyle = '#ffffff'
    context.font = '700 12px "Cairo", sans-serif'
    context.textBaseline = 'middle'
    context.fillText(
      'إجمالي مساحة الأعمال المنفذة للورشة:',
      (left + right) / 2,
      y + quantityTitleHeight / 2,
      width - 24,
    )
    context.textBaseline = 'alphabetic'
    y += quantityTitleHeight

    const quantityCellHeight = 24
    context.fillStyle = '#f3f9f8'
    context.fillRect(left + padding, y, width - padding * 2, quantityCellHeight)
    context.strokeStyle = '#c6a253'
    context.lineWidth = 1
    context.strokeRect(left + padding, y, width - padding * 2, quantityCellHeight)
    const quantitySummary = data.unitTotals.map(({ unit, quantity, amount }) =>
      `${invoiceQuantity(quantity)} ${unit} = ${amount === null ? '—' : `${money(amount)} $`}`).join('  |  ')
    let quantityFontSize = 11
    context.fillStyle = '#203044'
    do {
      context.font = `700 ${quantityFontSize}px "Cairo", sans-serif`
      if (context.measureText(quantitySummary).width <= width - 32 || quantityFontSize === 7) break
      quantityFontSize -= 1
    } while (true)
    context.fillText(quantitySummary, (left + right) / 2, y + 15, width - 32)
    y += quantityCellHeight
  }

  if (hasPayments && summaryPage.paymentRows.length > 0) {
    y += summaryPage.includeTotals ? 4 : 0
    const paymentsTitleHeight = 18
    context.fillStyle = '#007d79'
    context.fillRect(left + padding, y, width - padding * 2, paymentsTitleHeight)
    context.textAlign = 'center'
    context.fillStyle = '#ffffff'
    context.font = '700 11px "Cairo", sans-serif'
    context.fillText(
      summaryPage.includeTotals ? 'سجل الدفعات' : 'تكملة سجل الدفعات',
      (left + right) / 2,
      y + 13,
    )
    y += paymentsTitleHeight + 4

    summaryPage.paymentRows.forEach((row, rowIndex) => {
      const cardGap = 8
      const cardWidth = (width - padding * 2 - cardGap * (row.cards.length - 1)) / row.cards.length
      row.cards.forEach((card, cardIndex) => {
        const cardLeft = right - padding - (cardIndex + 1) * cardWidth - cardIndex * cardGap
        const cardTop = y
        context.fillStyle = cardIndex % 2 === 0 ? '#f3f9f8' : '#e8f5f2'
        context.fillRect(cardLeft, cardTop, cardWidth, row.height)
        context.strokeStyle = '#c6a253'
        context.lineWidth = 1
        context.strokeRect(cardLeft, cardTop, cardWidth, row.height)
        context.textAlign = 'center'
        context.fillStyle = '#006e69'
        context.font = '700 10px "Cairo", sans-serif'
        context.fillText(`الدفعة ${card.index + 1}`, cardLeft + cardWidth / 2, cardTop + 12, cardWidth - 10)
        context.fillStyle = '#203044'
        context.font = '800 13px "Cairo", sans-serif'
        context.fillText(`${money(card.payment.amount)} $`, cardLeft + cardWidth / 2, cardTop + 28, cardWidth - 10)
        if (card.sublabel) {
          context.fillStyle = '#667782'
          context.font = '600 8px "Cairo", sans-serif'
          wrapCanvasText(context, card.sublabel, cardWidth - 12).forEach((line, lineIndex) => {
            context.fillText(line, cardLeft + cardWidth / 2, cardTop + 39 + lineIndex * 10, cardWidth - 12)
          })
        }
      })
      y += row.height + (rowIndex < summaryPage.paymentRows.length - 1 ? 4 : 0)
    })
  }

  if (summaryPage.includeFinancialTotals) {
    const financialTitleHeight = hasPayments ? 18 : 22
    y += hasPayments ? 4 : 8
    context.fillStyle = '#e8f5f2'
    context.fillRect(left + padding, y, width - padding * 2, financialTitleHeight)
    context.textAlign = 'center'
    context.fillStyle = '#006e69'
    context.font = '700 12px "Cairo", sans-serif'
    context.textBaseline = 'middle'
    context.fillText('حساب إجمالي الفاتورة', (left + right) / 2, y + financialTitleHeight / 2)
    context.textBaseline = 'alphabetic'
    y += financialTitleHeight + (hasPayments ? 2 : 4)

    const discount = data.discount
    const hasDiscount = Boolean(discount?.amount)
    const finalTotal = data.total - (discount?.amount || 0)
    const summaryCards: Array<{
      label: string
      value: string
      fill: string
      color: string
      sublabel?: string
    }> = hasDiscount && discount
      ? [
        { label: 'الإجمالي قبل الخصم', value: `${money(data.total)} $`, fill: '#e8f5f2', color: '#006e69' },
        {
          label: discount.mode === 'percentage' ? `الخصم (${discount.value}%)` : 'قيمة الخصم',
          value: `${money(discount.amount)} $`,
          fill: '#fff0ed',
          color: '#c62828',
        },
        { label: 'الإجمالي بعد الخصم', value: `${money(finalTotal)} $`, fill: '#e8f5f2', color: '#006e69' },
      ]
      : [{
        label: 'الإجمالي النهائي',
        value: `${money(finalTotal)} $`,
        fill: '#e8f5f2',
        color: '#006e69',
      }]

    if (hasPayments) {
      const paidTotal = exportPayments.reduce(
        (sum, payment) => sum + (Number.isFinite(payment.amount) ? payment.amount : 0),
        0,
      )
      const remainingAmount = Number(Math.max(0, finalTotal - paidTotal).toFixed(2))
      const isFullyPaid = remainingAmount <= 0.00001
      summaryCards.push(
        {
          label: 'إجمالي الدفعات',
          value: `${money(paidTotal)} $`,
          fill: '#e8f5f2',
          color: '#006e69',
        },
        {
          label: isFullyPaid ? 'مسددة بالكامل' : 'المتبقي',
          value: `${money(remainingAmount)} $`,
          fill: isFullyPaid ? '#ecfdf3' : '#fff4e5',
          color: isFullyPaid ? '#166534' : '#c2410c',
        },
      )
    }

    const cardGap = 8
    const cardWidth = (width - padding * 2 - cardGap * (summaryCards.length - 1)) / summaryCards.length
    const cardHeight = hasPayments ? 48 : 58
    let cardRight = right - padding
    summaryCards.forEach((card) => {
      const cardLeft = cardRight - cardWidth
      context.fillStyle = card.fill
      context.fillRect(cardLeft, y, cardWidth, cardHeight)
      context.strokeStyle = card.color === '#c62828' ? card.color : '#c6a253'
      context.lineWidth = 1
      context.strokeRect(cardLeft, y, cardWidth, cardHeight)
      context.textAlign = 'center'
      context.fillStyle = card.color
      context.font = '700 10px "Cairo", sans-serif'
      context.fillText(card.label, cardLeft + cardWidth / 2, y + 15, cardWidth - 10)
      context.font = '800 14px "Cairo", sans-serif'
      if (
        card.label === 'الإجمالي النهائي'
        || card.label === 'الإجمالي بعد الخصم'
        || card.label === 'المتبقي'
        || card.label === 'مسددة بالكامل'
      ) {
        const valueBoxWidth = Math.min(cardWidth - 16, context.measureText(card.value).width + 20)
        const valueBoxY = y + 25
        context.strokeStyle = '#c62828'
        context.lineWidth = 2
        context.strokeRect(cardLeft + cardWidth / 2 - valueBoxWidth / 2, valueBoxY, valueBoxWidth, 20)
      }
      if (card.value) context.fillText(card.value, cardLeft + cardWidth / 2, y + 40, cardWidth - 10)
      if (card.sublabel) {
        context.fillStyle = '#166534'
        context.font = '600 8px "Cairo", sans-serif'
        context.fillText(card.sublabel, cardLeft + cardWidth / 2, y + 46, cardWidth - 10)
      }
      cardRight = cardLeft - cardGap
    })
    y += cardHeight
  }

  const bottom = y + padding
  context.strokeStyle = '#c6a253'
  context.lineWidth = 2
  context.strokeRect(left, top, width, bottom - top)
  return bottom
}

async function renderInvoiceCanvases(data: InvoiceExportData, imageScale: ImageExportScale) {
  await document.fonts.ready
  await Promise.all([
    document.fonts.load('600 14px Cairo'),
    document.fonts.load('700 14px Cairo'),
    document.fonts.load('800 14px Cairo'),
    document.fonts.load('800 16px Cairo'),
    document.fonts.load('800 18px Cairo'),
    document.fonts.load('800 20px Cairo'),
  ])
  const width = 840
  const height = 1188
  const headerHeight = 42
  const rowHeight = 32
  const tableLeft = 40
  const tableRight = 800
  const tableTop = 278
  const exportPayments = invoiceExportPayments(data)
  const hasPaymentsSection = exportPayments.length > 0
  const measureContext = document.createElement('canvas').getContext('2d')
  if (!measureContext) throw new Error('Canvas unavailable')
  const paymentRows = invoicePaymentDisplayRows(
    measureContext,
    exportPayments,
    tableRight - tableLeft - 12,
  )
  const exportNote = (data.exportNote || '').trim()
  const summaryBottomLimit = exportNote ? 1090 : 1120
  const summaryHeight = invoiceSummaryBlockHeight(true, true, hasPaymentsSection, paymentRows)
  const singlePageSummaryGap = 12
  const multiPageSummaryGap = 26
  const finalCapacityForGap = (gap: number) => Math.max(0, Math.min(
    invoiceFinalPageCapacity,
    Math.floor(
      (summaryBottomLimit - summaryHeight - gap - tableTop - headerHeight) / rowHeight,
    ),
  ))
  const singlePageFinalCapacity = finalCapacityForGap(singlePageSummaryGap)
  const multiPageFinalCapacity = finalCapacityForGap(multiPageSummaryGap)
  const servicePageRowCounts = invoicePageRowCounts(
    data.rows.length,
    singlePageFinalCapacity,
    multiPageFinalCapacity,
  )
  const firstSummaryTopGap = data.rows.length > singlePageFinalCapacity
    ? multiPageSummaryGap
    : singlePageSummaryGap
  const summaryPages = invoiceSummaryPagePlans(
    paymentRows,
    hasPaymentsSection,
    summaryBottomLimit - tableTop - firstSummaryTopGap,
    summaryBottomLimit - tableTop - singlePageSummaryGap,
  )
  const lastServicePageIndex = servicePageRowCounts.length - 1
  const pagePlans = servicePageRowCounts.map((serviceRowCount, pageIndex) => {
    const isSummaryPage = pageIndex === lastServicePageIndex
    return {
      serviceRowCount,
      tableRowCount: serviceRowCount === 0
        ? 0
        : isSummaryPage && summaryPages.length === 1
          ? serviceRowCount
          : invoiceContinuationPageCapacity,
      summary: isSummaryPage ? summaryPages[0] : null,
    }
  })
  summaryPages.slice(1).forEach((summary) => {
    pagePlans.push({ serviceRowCount: 0, tableRowCount: 0, summary })
  })
  const pageCount = pagePlans.length
  const hasNotes = data.rows.some((row) => row.notes.trim())
  const valueColumnWidth = hasNotes ? 117 : 376 / 3
  const columns = [
    { title: 'م', width: 42, key: 'number' },
    { title: 'اسم الخدمة', width: hasNotes ? 237 : 342, key: 'name' },
    { title: 'سعر الوحدة ($)', width: valueColumnWidth, key: 'unitPrice' },
    { title: 'الكمية', width: valueColumnWidth, key: 'quantity' },
    { title: 'الإجمالي ($)', width: valueColumnWidth, key: 'total' },
    ...(hasNotes ? [{ title: 'الملاحظات', width: 130, key: 'notes' }] : []),
  ]
  const canvases: HTMLCanvasElement[] = []
  let rowOffset = 0

  for (let pageIndex = 0; pageIndex < pageCount; pageIndex += 1) {
    const pagePlan = pagePlans[pageIndex]
    const isSummaryOnlyPage = pagePlan.serviceRowCount === 0
    const hasCompletionNotice = Boolean(
      pagePlan.summary?.includeTotals && data.rows.length > 0 && pageIndex > 0,
    )
    const pageRows = data.rows.slice(rowOffset, rowOffset + pagePlan.serviceRowCount)
    const tableRowCount = pagePlan.tableRowCount
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
    const companyDividerY = drawInvoiceCompanyBranding(context, width)
    const invoiceTitleY = companyDividerY === null ? 118 : Math.max(129, companyDividerY + 31)
    context.fillStyle = '#007d79'
    context.font = '700 19px "Cairo", sans-serif'
    context.fillText('فاتورة حساب للأعمال المنفذة', width / 2, invoiceTitleY)
    const customerSegments = customerDetailsSegments(data)
    const workshopTeacherLines = workshopTeacherSegments(data.workshopName, data.responsibleTeacherName)
    const customerY = companyDividerY === null ? 138 : invoiceTitleY + 29
    drawDetailSegments(context, width, customerY, customerSegments, true)
    const teacherY = customerSegments.length
      ? customerY + (companyDividerY === null ? 24 : 32)
      : customerY
    drawDetailSegments(context, width, teacherY, workshopTeacherLines, true)
    context.textAlign = 'left'
    context.fillStyle = '#a64b37'
    context.font = '700 13px "Cairo", sans-serif'
    context.fillText(`رقم الفاتورة: ${data.invoiceNumber}`, tableLeft, invoiceTitleY)
    context.textAlign = 'right'
    context.fillStyle = '#111111'
    context.font = '800 13px "Cairo", sans-serif'
    context.fillText(`صفحة ${pageIndex + 1} من ${pageCount}`, tableRight, invoiceTitleY)
    const dateY = workshopTeacherLines.length
      ? teacherY + (companyDividerY === null ? 24 : 32)
      : customerY + (companyDividerY === null ? 26 : 34)
    drawDetailSegments(context, width, dateY, [
      { text: 'تاريخ الإصدار: ', red: false },
      { text: formatInvoicePrintDateTime(data.exportDate), red: true },
    ], true)
    context.textAlign = 'center'
    context.fillStyle = '#111111'
    context.font = '800 14px "Cairo", sans-serif'
    const noticeY = (data.exportNote || '').trim() && pageIndex === pageCount - 1 ? 1158 : 1144
    context.fillText(
      'تنويه: هذه فاتورة حساب عن أعمال تم تنفيذها، وتوضح قيمة الخدمات المنفذة وفق البيانات أعلاه.',
      width / 2,
      noticeY,
      tableRight - tableLeft,
    )

    if (pageRows.length > 0) {
      const headerY = tableTop
      columns.reduce((right, column) => {
        const left = right - column.width
        context.fillStyle = '#007d79'
        context.fillRect(left, headerY, column.width, headerHeight)
        context.strokeStyle = '#000000'
        context.lineWidth = 1
        context.strokeRect(left, headerY, column.width, headerHeight)
        context.fillStyle = '#ffffff'
        context.font = '700 12px "Cairo", sans-serif'
        context.textAlign = 'center'
        context.fillText(column.title, left + column.width / 2, headerY + 27, column.width - 8)
        return left
      }, tableRight)

      for (let rowIndex = 0; rowIndex < tableRowCount; rowIndex += 1) {
        const row = pageRows[rowIndex]
        const y = tableTop + headerHeight + rowIndex * rowHeight
        context.fillStyle = rowIndex % 2 === 0 ? '#f3f9f8' : '#f6f8fb'
        context.fillRect(tableLeft, y, tableRight - tableLeft, rowHeight)
        context.strokeStyle = '#000000'
        context.lineWidth = 1
        context.strokeRect(tableLeft, y, tableRight - tableLeft, rowHeight)
        let right = tableRight
        columns.forEach((column) => {
          const left = right - column.width
          context.strokeRect(left, y, column.width, rowHeight)
          const value = column.key === 'number'
            ? row ? String(pageRowOffset + rowIndex + 1) : ''
            : !row
              ? ''
              : column.key === 'name'
                ? row.name
                : column.key === 'notes'
                  ? row.notes.trim() || '—'
                  : column.key === 'quantity'
                    ? `${invoiceQuantity(row.quantity)}${row.unit ? ` ${row.unit}` : ''}`
                    : column.key === 'unitPrice'
                      ? `${money(row.unitPrice)} $`
                      : `${money(row.total)} $`
          context.fillStyle = '#203044'
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
      }
    }

    const tableBottomY = pageRows.length > 0
      ? tableTop + headerHeight + tableRowCount * rowHeight
      : tableTop
    if (hasCompletionNotice) {
      context.textAlign = 'center'
      context.fillStyle = '#52616d'
      context.font = '700 12px "Cairo", sans-serif'
      context.fillText(
        isSummaryOnlyPage ? 'اكتملت الخدمات في الصفحة السابقة' : 'اكتملت الخدمات في هذه الصفحة',
        width / 2,
        tableBottomY + 14,
      )
    }

    if (!pagePlan.summary && pagePlan.serviceRowCount > 0) {
      const hasRemainingServices = pageRowOffset + pageRows.length < data.rows.length
      context.textAlign = 'center'
      context.fillStyle = '#006e69'
      context.font = '700 12px "Cairo", sans-serif'
      context.fillText(
        hasRemainingServices ? 'يتبع جدول الخدمات في الصفحة التالية' : 'ملخص الفاتورة في الصفحة التالية',
        width / 2,
        1118,
        tableRight - tableLeft,
      )
    }

    if (pagePlan.summary) {
      const summaryTop = tableBottomY + (
        hasCompletionNotice ? multiPageSummaryGap : singlePageSummaryGap
      )
      drawInvoiceSummary(
        context,
        data,
        exportPayments,
        pagePlan.summary,
        hasPaymentsSection,
        tableLeft,
        tableRight,
        summaryTop,
      )
    }

    if (pagePlan.summary && pageIndex < pageCount - 1) {
      context.textAlign = 'center'
      context.fillStyle = '#006e69'
      context.font = '700 12px "Cairo", sans-serif'
      context.fillText('يتبع سجل الدفعات في الصفحة التالية', width / 2, 1118, tableRight - tableLeft)
    }

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

    canvases.push(canvas)
  }
  return canvases
}

async function exportInvoiceImage(
  button: HTMLButtonElement,
  data: InvoiceExportData,
  imageScale: ImageExportScale,
) {
  button.disabled = true
  try {
    const files = await renderInvoiceImageFiles(data, imageScale)
    downloadInvoiceFiles(files)
    showToast(imageScale === highQualityImageScale ? 'تم تصدير الفاتورة كصورة فائقة.' : 'تم تصدير الفاتورة كصورة.')
    return true
  } catch (error) {
    console.error('Failed to export invoice image:', error)
    showToast('تعذر تصدير صورة الفاتورة. حاول مجددًا.')
    return false
  } finally {
    button.disabled = false
  }
}

async function renderInvoiceImageFiles(data: InvoiceExportData, imageScale: ImageExportScale): Promise<File[]> {
  const canvases = await renderInvoiceCanvases(data, imageScale)
  return Promise.all(canvases.map((canvas, pageIndex) => new Promise<File>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) {
        reject(new Error('Could not create invoice image'))
        return
      }
      resolve(new File([blob], `فاتورة-${data.invoiceNumber}-${data.exportDate}-صفحة-${pageIndex + 1}.png`, {
        type: 'image/png',
      }))
    }, 'image/png')
  })))
}

function downloadInvoiceFiles(files: File[]) {
  files.forEach((file) => {
    const url = URL.createObjectURL(file)
    const link = document.createElement('a')
    link.href = url
    link.download = file.name
    document.body.append(link)
    link.click()
    link.remove()
    window.setTimeout(() => URL.revokeObjectURL(url), 1000)
  })
}

async function shareInvoiceFiles(files: File[], data: InvoiceExportData): Promise<'shared' | 'downloaded' | 'cancelled'> {
  if (typeof navigator.share !== 'function' || (navigator.canShare && !navigator.canShare({ files }))) {
    downloadInvoiceFiles(files)
    return 'downloaded'
  }
  try {
    await navigator.share({
      files,
      title: `فاتورة رقم ${data.invoiceNumber}`,
      text: `فاتورة رقم ${data.invoiceNumber}`,
    })
    return 'shared'
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') return 'cancelled'
    if (error instanceof TypeError || (error instanceof DOMException && error.name === 'NotAllowedError')) {
      downloadInvoiceFiles(files)
      return 'downloaded'
    }
    throw error
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

function formatInvoicePrintDateTime(value: string): string {
  const parts = value.trim().match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})$/)
  const date = parts
    ? new Date(Number(parts[1]), Number(parts[2]) - 1, Number(parts[3]), Number(parts[4]), Number(parts[5]))
    : new Date(value)
  if (Number.isNaN(date.getTime())) return value

  const weekdays = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت']
  const day = String(date.getDate()).padStart(2, '0')
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const hour = String(date.getHours()).padStart(2, '0')
  const minute = String(date.getMinutes()).padStart(2, '0')
  return `${weekdays[date.getDay()]} ${day}-${month}-${date.getFullYear()} | الساعة ${hour}:${minute}`
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
  if (record.items.length) return record.items.map((item) => ({ ...item }))
  return record.rows.map((row) => ({
    custom: true,
    name: row.name,
    notes: row.notes,
    quantity: String(row.quantity),
    price: String(row.unitPrice),
    unit: row.unit,
    unitCode: null as ServiceUnit | null,
    currencyCode: 'USD',
  }))
}

function getInvoiceEditableItemId(item: StoredInvoiceEditableItem, index: number): number {
  return typeof item.id === 'number' && Number.isSafeInteger(item.id) && item.id > 0
    ? item.id
    : index + 1
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
    customerNeighborhood: customers.find((customer) => customer.id === record.customerId)?.neighborhood || '',
    workshopName: record.workshopName || '',
    responsibleTeacherName: record.responsibleTeacherName || accountProfile.name,
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
    items: record.items.map(({ id: _id, ...item }) => item),
    total: record.total,
    discount: record.discount,
    customerId: record.customerId,
    customerName: record.customerName,
    customerPhone: record.customerPhone,
    customerAddress: record.customerAddress,
    workshopName: record.workshopName,
    responsibleTeacherName: record.responsibleTeacherName,
  })
}

type CorrectionChange = { label: string; before?: string; after?: string; text?: string }
type CorrectionEntry = { version: InvoiceRecord; when: string; summary: string; tags: string[]; changes: CorrectionChange[] }

function describeDiscount(discount: StoredInvoiceDiscount): string {
  if (!discount || !Number.isFinite(discount.amount) || discount.amount <= 0) return 'بدون خصم'
  return discount.mode === 'percentage'
    ? `${money(discount.amount)} $ (${money(discount.value)}%)`
    : `${money(discount.amount)} $ (مبلغ ثابت)`
}

function correctionItemName(item: { name?: string }, index: number): string {
  const name = (item.name || '').trim()
  return name ? `الخدمة "${name}"` : `خدمة #${index + 1}`
}

function describePayment(payment: InvoicePayment | undefined): string {
  if (!payment) return '—'
  const amount = Number.isFinite(payment.amount) ? `${money(payment.amount)} $` : '—'
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
  push('اسم الورشة', (previous.workshopName || '').trim() || '—', (current.workshopName || '').trim() || '—', 'بيانات')
  push('المعلم المسؤول', (previous.responsibleTeacherName || '').trim() || '—', (current.responsibleTeacherName || '').trim() || '—', 'بيانات')

  const prevDiscount = describeDiscount(previous.discount)
  const currDiscount = describeDiscount(current.discount)
  if (prevDiscount !== currDiscount) {
    changes.push({ label: 'الخصم', before: prevDiscount, after: currDiscount })
    tags.add('خصم')
  }

  const prevItems = getInvoiceRecordEditableItems(previous)
  const currItems = getInvoiceRecordEditableItems(current)
  const prevItemsById = new Map(prevItems.map((item, index) => [getInvoiceEditableItemId(item, index), { item, index }]))
  const currItemsById = new Map(currItems.map((item, index) => [getInvoiceEditableItemId(item, index), { item, index }]))
  for (const [id, { item: prev, index }] of prevItemsById) {
    const currentEntry = currItemsById.get(id)
    if (!currentEntry) {
      changes.push({ label: 'إزالة خدمة', text: `${(prev.name || '').trim() || `خدمة #${index + 1}`} (إزالة من الفاتورة)` })
      tags.add('خدمات')
      continue
    }
    const curr = currentEntry.item
    const name = correctionItemName(curr.name ? curr : prev, index)
    const itemChanges: string[] = []
    if ((prev.name || '').trim() !== (curr.name || '').trim()) itemChanges.push(`الاسم: ${(prev.name || '').trim() || '—'} ← ${(curr.name || '').trim() || '—'}`)
    if ((prev.unit || '').trim() !== (curr.unit || '').trim()) itemChanges.push(`الوحدة: ${(prev.unit || '').trim() || '—'} ← ${(curr.unit || '').trim() || '—'}`)
    if ((prev.quantity || '').trim() !== (curr.quantity || '').trim()) itemChanges.push(`الكمية: ${(prev.quantity || '').trim() || '—'} ← ${(curr.quantity || '').trim() || '—'}`)
    if ((prev.price || '').trim() !== (curr.price || '').trim()) itemChanges.push(`السعر: ${(prev.price || '').trim() || '—'} ← ${(curr.price || '').trim() || '—'} $`)
    if ((prev.notes || '').trim() !== (curr.notes || '').trim()) itemChanges.push(`الملاحظات: ${(prev.notes || '').trim() || '—'} ← ${(curr.notes || '').trim() || '—'}`)
    if (itemChanges.length) {
      changes.push({ label: name, text: itemChanges.join(' • ') })
      tags.add('خدمات')
    }
  }
  for (const [id, { item: curr, index }] of currItemsById) {
    if (prevItemsById.has(id)) continue
    const qty = curr.quantity?.trim() ? curr.quantity.trim() : '—'
    const price = curr.price?.trim() ? `${money(Number(curr.price))} $` : '—'
    changes.push({
      label: 'إضافة خدمة',
      text: `${(curr.name || '').trim() || `خدمة #${index + 1}`} (${qty} ${curr.unit || ''} × ${price})`.trim(),
    })
    tags.add('خدمات')
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
    changes.push({ label: 'صافي الفاتورة', before: `${money(prevNet)} $`, after: `${money(currNet)} $` })
    tags.add('مبالغ')
  }
  const prevRemaining = getInvoiceRemainingTotal(previous)
  const currRemaining = getInvoiceRemainingTotal(current)
  if (Math.abs(prevRemaining - currRemaining) > 0.00001) {
    changes.push({ label: 'المتبقي', before: `${money(prevRemaining)} $`, after: `${money(currRemaining)} $` })
    tags.add('دفعات')
  }

  const tagList = [...tags]
  let summary = 'تحديث على الفاتورة'
  const hasBase = tagList.some((tag) => ['خصم', 'خدمات', 'بيانات', 'مبالغ'].includes(tag)) && (invoiceTermsSignature(previous) !== invoiceTermsSignature(current))
  const hasPayments = tagList.includes('دفعات') && paymentsSignature(previous) !== paymentsSignature(current)
  if (hasBase && hasPayments) summary = 'تعديل الفاتورة وحركة دفعة'
  else if (hasPayments && !hasBase) {
    const added = currPayments.length > prevPayments.length
    const removed = currPayments.length < prevPayments.length
    summary = added ? 'إضافة دفعة' : removed ? 'حذف دفعة' : 'تعديل دفعة'
  } else if (tagList.length === 1) {
    summary = tagList[0] === 'خصم' ? 'تعديل الخصم'
      : tagList[0] === 'خدمات' ? 'تعديل الخدمات'
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
  if (currentLinkedCustomer?.archived && !sourceRecord) {
    throw new CustomerIdentityError(`الزبون ${currentLinkedCustomer.name} مؤرشف. استعده من تبويب الأرشيف قبل ربط فاتورة جديدة به.`)
  }
  const identityMatch = findCustomerIdentityMatch(
    enteredCustomerName,
    data.customerPhone,
    data.customerAddress,
    data.customerNeighborhood,
    currentLinkedCustomer?.id,
  )
  if (identityMatch) {
    throw new CustomerIdentityError(customerIdentityMessage(identityMatch, 'invoice'))
  }
  const matchingCustomer = currentLinkedCustomer
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
    neighborhood: data.customerNeighborhood.trim(),
    notes: '',
    archived: false,
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
      workshopName: data.workshopName,
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
    workshopName: data.workshopName,
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
    onInvoiceSaved?: () => void
  },
) {
  const mode = context?.mode || 'export-save'
  const isExportOnly = mode === 'export-only'
  const isSaveCorrection = mode === 'save-correction'
  const isExportSave = mode === 'export-save'
  const allowDataEdit = !isExportOnly
  const showFormat = isExportOnly
  const formatAmount = (value: number) => formatUsdAmount(value)
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
          <label for="invoice-customer-export-name">اسم الزبون <span>(مطلوب)</span></label>
          <div class="invoice-customer-name-control">
            <input id="invoice-customer-export-name" type="text" maxlength="20" placeholder="اسم الزبون" autocomplete="name">
            <button type="button" class="invoice-customer-picker-trigger" aria-label="اختيار زبون مسجل" title="اختيار زبون مسجل">
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m7 10 5 5 5-5" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2.2"/></svg>
            </button>
          </div>
        </div>
        <label for="invoice-customer-export-phone">رقم هاتف الزبون <span>(اختياري)</span>
          <input id="invoice-customer-export-phone" type="tel" maxlength="15" inputmode="tel" placeholder="رقم الهاتف" autocomplete="tel">
        </label>
        <label for="invoice-customer-export-address">عنوان الزبون <span>(اختياري)</span>
          <input id="invoice-customer-export-address" type="text" maxlength="15" placeholder="عنوان الزبون">
        </label>
        <label for="invoice-customer-export-neighborhood">الحي <span>(اختياري)</span>
          <input id="invoice-customer-export-neighborhood" type="text" maxlength="15" placeholder="الحي" disabled>
        </label>
        <label for="invoice-responsible-teacher-name">اسم المعلم المسؤول <span>(اختياري)</span>
          <input id="invoice-responsible-teacher-name" type="text" maxlength="20" placeholder="اسم المعلم المسؤول">
        </label>
        <label for="invoice-workshop-name">اسم الورشة <span>(اختياري)</span>
          <input id="invoice-workshop-name" type="text" maxlength="40" placeholder="اسم الورشة">
        </label>
      </div>`}
      <div class="invoice-export-summary">
        <div class="invoice-export-count-card"><span>عدد الخدمات</span><strong>${data.rows.length}</strong></div>
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
        </fieldset>` : ''}
        ${allowDataEdit ? `
        <fieldset class="invoice-discount-options">
          <legend>تفعيل الخصم</legend>
          <div class="invoice-discount-option">
            <button type="button" data-invoice-discount-mode="amount" aria-pressed="false">خصم مبلغ</button>
            <label class="invoice-discount-value"><input id="invoice-discount-amount" type="number" min="0.01" max="${data.total}" step="0.01" inputmode="decimal" aria-label="قيمة الخصم بال$" disabled><span>$</span></label>
          </div>
          <div class="invoice-discount-option">
            <button type="button" data-invoice-discount-mode="percentage" aria-pressed="false">خصم مئوي</button>
            <label class="invoice-discount-value"><input id="invoice-discount-percentage" type="number" min="0.01" max="100" step="0.01" inputmode="decimal" aria-label="نسبة الخصم بالمئة" disabled><span>%</span></label>
          </div>
        </fieldset>` : ''}
        ${isExportOnly ? `
        <fieldset class="invoice-export-note-field">
          <legend>ملاحظة اختيارية للفاتورة</legend>
          <textarea id="invoice-export-note" aria-label="ملاحظة اختيارية للفاتورة" maxlength="300" rows="3" placeholder="أدخل ملاحظة اختيارية لتظهر في أسفل الفاتورة">${escapeHtml(data.exportNote || '')}</textarea>
        </fieldset>` : ''}
      </div>
      ${isExportOnly ? `
      <fieldset class="invoice-share-panel">
        <legend>مشاركة الفاتورة</legend>
        <button type="button" class="secondary-button invoice-share-button" data-invoice-share>مشاركة الفاتورة</button>
        <p class="invoice-share-hint">ستتم مشاركة الفاتورة حسب نوع التصدير المحدد أعلاه.</p>
      </fieldset>` : ''}
      ${allowDataEdit ? '<p class="invoice-customer-identity-warning" data-invoice-customer-warning role="alert" aria-live="polite" hidden></p>' : ''}
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
  const neighborhoodInput = backdrop.querySelector<HTMLInputElement>('#invoice-customer-export-neighborhood')
  const responsibleTeacherInput = backdrop.querySelector<HTMLInputElement>('#invoice-responsible-teacher-name')
  const workshopNameInput = backdrop.querySelector<HTMLInputElement>('#invoice-workshop-name')
  const customerPickerButton = backdrop.querySelector<HTMLButtonElement>('.invoice-customer-picker-trigger')
  const percentageInput = backdrop.querySelector<HTMLInputElement>('#invoice-discount-percentage')
  const amountInput = backdrop.querySelector<HTMLInputElement>('#invoice-discount-amount')
  const exportNoteInput = backdrop.querySelector<HTMLTextAreaElement>('#invoice-export-note')
  const customerIdentityWarning = backdrop.querySelector<HTMLElement>('[data-invoice-customer-warning]')
  const numberLabel = backdrop.querySelector<HTMLElement>('.invoice-export-number')!
  const previewSection = backdrop.querySelector<HTMLElement>('[data-invoice-inline-preview]')!
  const previewPages = backdrop.querySelector<HTMLElement>('[data-invoice-inline-pages]')!
  const previewStatus = backdrop.querySelector<HTMLElement>('[data-invoice-inline-status]')!
  const previewButton = backdrop.querySelector<HTMLButtonElement>('.invoice-customer-export-preview')!
  const confirmButton = backdrop.querySelector<HTMLButtonElement>('.invoice-customer-export-confirm')!
  const shareButton = backdrop.querySelector<HTMLButtonElement>('[data-invoice-share]')
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
  const initiallySelectedCustomer = selectedCustomerId
    ? customers.find((customer) => customer.id === selectedCustomerId)
    : undefined
  if (selectedCustomerId && !data.customerNeighborhood) {
    data.customerNeighborhood = initiallySelectedCustomer?.neighborhood || ''
  }
  let selectedCustomerName = selectedCustomerId
    ? data.customerName.trim() || initiallySelectedCustomer?.name || ''
    : ''
  let closeCustomerPicker: ((restoreFocus?: boolean) => void) | null = null

  if (nameInput) nameInput.value = data.customerName || ''
  if (phoneInput) phoneInput.value = data.customerPhone || ''
  if (addressInput) addressInput.value = data.customerAddress || ''
  if (neighborhoodInput) {
    neighborhoodInput.value = data.customerNeighborhood || ''
    neighborhoodInput.disabled = Boolean(selectedCustomerId) || !Boolean(data.customerAddress.trim())
  }
  if (selectedCustomerId) {
    if (phoneInput) phoneInput.disabled = true
    if (addressInput) addressInput.disabled = true
  }
  if (responsibleTeacherInput) {
    data.responsibleTeacherName = data.responsibleTeacherName || accountProfile.name
    responsibleTeacherInput.value = data.responsibleTeacherName
  }
  if (workshopNameInput) workshopNameInput.value = data.workshopName || ''
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
    return selectedFormat === 'image-high' ? 'صورة فائقة' : 'صورة عادية'
  }
  const syncExportData = (notifyInvalid = false) => {
    const invalidField = allowDataEdit ? [
      { label: 'اسم الزبون', input: nameInput, max: 20 },
      { label: 'رقم الهاتف', input: phoneInput, max: 15 },
      { label: 'العنوان', input: addressInput, max: 15 },
      { label: 'الحي', input: neighborhoodInput, max: 15 },
      { label: 'اسم المعلم', input: responsibleTeacherInput, max: 20 },
      { label: 'اسم الورشة', input: workshopNameInput, max: 40 },
    ].find(({ input, max }) => input !== null && input.value.length > max) : undefined
    if (invalidField) {
      if (notifyInvalid) showToast(`يجب ألا يتجاوز ${invalidField.label} ${invalidField.max} حرفًا.`)
      return false
    }
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
          showToast(`إجمالي الدفعات المسجلة (${money(paidTotal)} $) أكبر من صافي الفاتورة (${money(netTotal)} $). عدّل الخصم/الإجمالي بما يتوافق مع الدفعات.`)
        }
        return false
      }
    }
    if (allowDataEdit) {
      data.customerName = nameInput?.value.trim() || ''
      data.customerPhone = phoneInput?.value.trim() || ''
      data.customerAddress = addressInput?.value.trim() || ''
      data.customerNeighborhood = neighborhoodInput?.value.trim() || ''
      data.workshopName = workshopNameInput?.value.trim() || ''
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
      data.exportFormat = selectedFormat === 'image-high' ? 'image-high' : 'image'
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
  const updateCustomerIdentityWarning = () => {
    if (!customerIdentityWarning) return
    const customerName = nameInput?.value.trim() || ''
    const linkedCustomer = selectedCustomerId
      ? customers.find((customer) => customer.id === selectedCustomerId)
      : undefined
    const identityMatch = findCustomerIdentityMatch(
      customerName,
      phoneInput?.value || '',
      addressInput?.value || '',
      neighborhoodInput?.value || '',
      linkedCustomer?.id,
    )
    const warningMessage = !customerName
      ? 'اسم الزبون مطلوب لحفظ الفاتورة. أدخل اسمًا جديدًا أو اختر زبونًا مسجلًا من السهم داخل خانة الاسم.'
      : identityMatch
        ? customerIdentityMessage(identityMatch, 'invoice')
        : ''
    customerIdentityWarning.hidden = !warningMessage
    customerIdentityWarning.textContent = warningMessage
    confirmButton.disabled = confirmingExport || !customerName || Boolean(identityMatch)
  }
  const updateNeighborhoodAvailability = (clearWhenDisabled = false) => {
    const hasAddress = Boolean(addressInput?.value.trim())
    if (!hasAddress && clearWhenDisabled && neighborhoodInput) neighborhoodInput.value = ''
    if (neighborhoodInput) {
      neighborhoodInput.disabled = Boolean(selectedCustomerId) || !hasAddress
    }
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
      const activeCustomers = customers.filter((customer) => !customer.archived)
      const visibleCustomers = [...activeCustomers]
        .filter((customer) => [customer.name, customer.phone, customer.address, customer.neighborhood]
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
              ${customer.neighborhood ? `<span class="invoice-customer-picker-contact-separator" aria-hidden="true">|</span><span class="invoice-customer-picker-address">${escapeHtml(customer.neighborhood)}</span>` : ''}
            </span>
          </span>
          <span class="invoice-customer-picker-option-arrow" aria-hidden="true">‹</span>
        </button>`).join('')
      emptyState.textContent = activeCustomers.length
        ? 'لا توجد نتائج مطابقة لبحثك.'
        : 'لا يوجد زبائن نشطون. استعد الزبون المؤرشف من الأرشيف أو أدخل اسم زبون جديد.'
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
      linkedExistingCustomer = true
      data.customerId = customer.id
      data.customerNeighborhood = customer.neighborhood
      nameInput.value = customer.name
      phoneInput.value = customer.phone
      addressInput.value = customer.address
      if (neighborhoodInput) {
        neighborhoodInput.value = customer.neighborhood
        neighborhoodInput.disabled = true
      }
      phoneInput.disabled = true
      addressInput.disabled = true
      updateCustomerIdentityWarning()
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
      neighborhoodInput,
      customerPickerButton,
      responsibleTeacherInput,
      percentageInput,
      amountInput,
      exportNoteInput,
      shareButton,
      ...formatInputs,
      ...modeButtons,
    ].filter((control): control is HTMLInputElement | HTMLButtonElement | HTMLTextAreaElement => Boolean(control)).forEach((control) => {
      control.disabled = disabled
    })
    if (phoneInput) phoneInput.disabled = disabled || Boolean(selectedCustomerId)
    if (addressInput) addressInput.disabled = disabled || Boolean(selectedCustomerId)
    if (neighborhoodInput) {
      neighborhoodInput.disabled = disabled || Boolean(selectedCustomerId) || !Boolean(addressInput?.value.trim())
    }
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
      linkedExistingCustomer = false
      data.customerId = null
      if (phoneInput) {
        phoneInput.value = ''
        phoneInput.disabled = false
      }
      if (addressInput) {
        addressInput.value = ''
        addressInput.disabled = false
      }
      if (neighborhoodInput) neighborhoodInput.value = ''
      updateNeighborhoodAvailability()
    }
    updateCustomerIdentityWarning()
    invalidatePreview()
  })
  phoneInput?.addEventListener('input', () => {
    updateCustomerIdentityWarning()
    invalidatePreview()
  })
  addressInput?.addEventListener('input', () => {
    updateNeighborhoodAvailability(true)
    updateCustomerIdentityWarning()
    invalidatePreview()
  })
  neighborhoodInput?.addEventListener('input', () => {
    updateCustomerIdentityWarning()
    invalidatePreview()
  })
  responsibleTeacherInput?.addEventListener('input', invalidatePreview)
  formatInputs.forEach((input) => input.addEventListener('change', invalidatePreview))
  exportNoteInput?.addEventListener('input', invalidatePreview)
  let sharingInvoice = false
  const setSharingInvoice = (sharing: boolean) => {
    sharingInvoice = sharing
    if (shareButton) shareButton.disabled = sharing
  }
  shareButton?.addEventListener('click', async () => {
    if (sharingInvoice) return
    if (!syncExportData(true)) return
    setSharingInvoice(true)
    try {
      const files = await renderInvoiceImageFiles(data, data.exportFormat === 'image-high' ? highQualityImageScale : 1)
      const result = await shareInvoiceFiles(files, data)
      if (result === 'shared') showToast('تم تسليم الفاتورة إلى التطبيق المختار.')
      else if (result === 'downloaded') showToast('مشاركة الملفات غير مدعومة. تم تنزيل الفاتورة حسب النوع المحدد.')
    } catch (error) {
      console.error('Failed to share invoice:', error)
      showToast('تعذرت مشاركة الفاتورة. حاول مجددًا.')
    } finally {
      setSharingInvoice(false)
    }
  })
  updateCustomerIdentityWarning()
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
  let linkedExistingCustomer = Boolean(selectedCustomerId)
  const resolveInvoiceCustomer = () => {
    if (!data.customerName.trim()) {
      if (customerIdentityWarning) {
        customerIdentityWarning.textContent = 'اسم الزبون مطلوب لحفظ الفاتورة. أدخل اسمًا جديدًا أو اختر زبونًا مسجلًا من السهم داخل خانة الاسم.'
        customerIdentityWarning.hidden = false
      }
      confirmButton.disabled = true
      return false
    }
    const linkedCustomer = selectedCustomerId
      ? customers.find((customer) => customer.id === selectedCustomerId)
      : undefined
    const identityMatch = findCustomerIdentityMatch(
      data.customerName,
      data.customerPhone,
      data.customerAddress,
      data.customerNeighborhood,
      linkedCustomer?.id,
    )
    if (identityMatch) {
      const message = customerIdentityMessage(identityMatch, 'invoice')
      if (customerIdentityWarning) {
        customerIdentityWarning.textContent = message
        customerIdentityWarning.hidden = false
      }
      confirmButton.disabled = true
      return false
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
    let identitySaveError = false
    try {
      if (dataUserId !== ownerId) throw new Error('Invoice owner changed before export confirmation')

      if (mode === 'export-only') {
        previewStatus.textContent = `جارٍ تصدير الفاتورة بصيغة ${getFormatLabel()}...`
        const successful = await exportInvoiceImage(
          confirmButton,
          data,
          data.exportFormat === 'image-high' ? highQualityImageScale : 1,
        )
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
        context?.onInvoiceSaved?.()
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
        context?.onInvoiceSaved?.()
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
        const successful = await exportInvoiceImage(
          confirmButton,
          data,
          data.exportFormat === 'image-high' ? highQualityImageScale : 1,
        )
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
        identitySaveError = true
        if (customerIdentityWarning) {
          customerIdentityWarning.textContent = error.message
          customerIdentityWarning.hidden = false
        }
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
        if (identitySaveError) {
          setFormDisabled(false)
          previewButton.disabled = false
          confirmButton.textContent = confirmLabel
        } else if (mode === 'export-only' || mode === 'save-correction') {
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
        if (identitySaveError) confirmButton.disabled = true
        else if (customerIdentityWarning) updateCustomerIdentityWarning()
        else confirmButton.disabled = false
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
    ${options?.correction
      ? `<h2>تصحيح حساب الفاتورة رقم ${escapeHtml(correctionInvoiceNumber)}</h2>`
      : `<p class="eyebrow">تجهيز فاتورة</p>
        <h2>تجهيز نافذة فاتورة</h2>
        <div class="export-tabs">
          <button class="active" type="button" data-export-tab="invoice">حساب فاتورة</button>
          <button type="button" data-export-tab="services">الخدمات</button>
        </div>`}
    <div id="export-services-panel" hidden class="hidden">
      <div class="export-service-list"></div>
      <div class="export-summary" aria-live="polite"></div>
      <div class="export-service-actions">
        <button class="secondary-button" id="cancel-export-services" type="button">إلغاء</button>
        <button class="primary-button" id="continue-export-services" type="button">متابعة التجهيز</button>
      </div>
    </div>
    <div id="export-invoice-panel"></div>`, { preserveExisting: Boolean(options?.correction) })
  if (options?.correction) {
    element.querySelector<HTMLElement>('.modal')!.classList.add('invoice-correction-modal')
  }
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
      }))
    sourceItems.forEach((item, index) => {
      const itemId = getInvoiceEditableItemId(item, index)
      nextInvoiceItemId = Math.max(nextInvoiceItemId, itemId + 1)
      invoiceItems.push({
        id: itemId,
        custom: item.custom,
        name: item.name,
        notes: item.notes,
        quantity: item.quantity,
        price: item.price,
        unit: item.unit,
        unitCode: item.unitCode,
        currencyCode: item.currencyCode || 'USD',
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
          ${invoiceItems.map(({ id, custom, name, notes, quantity, price, unit }, index) => `
            <article class="invoice-service-card" data-invoice-item="${id}">
              <span class="service-order invoice-card-order" aria-label="ترتيب الخدمة ${index + 1} في الفاتورة">${index + 1}</span>
              <div class="invoice-card-header">
                ${custom
                  ? `<input class="invoice-custom-name" type="text" data-invoice-name="${id}" maxlength="50" value="${escapeHtml(name)}" aria-label="اسم الخدمة غير المسجلة" placeholder="اسم الخدمة">`
                  : `<h3>${escapeHtml(name)}</h3>`}
                <button class="invoice-remove-service" type="button" data-invoice-remove="${id}" aria-label="حذف ${escapeHtml(name || 'الخدمة')}" title="حذف الخدمة">
                  ${svg('trash')}
                </button>
              </div>
              <label class="invoice-notes-row">
                <span class="invoice-notes-label">ملاحظة</span>
                <input class="invoice-notes-field" type="text" data-invoice-notes="${id}" maxlength="35" value="${escapeHtml(notes)}" placeholder="أضف ملاحظة اختيارية عن الخدمة" aria-label="ملاحظات الخدمة">
              </label>
              <div class="invoice-service-fields">
                <div class="invoice-field invoice-quantity-field">
                  <span class="invoice-field-heading">
                    <span class="invoice-quantity-heading">الكمية</span>
                    <span class="invoice-unit-group">
                      ${custom
                        ? `<input class="invoice-unit-cell invoice-unit-input" type="text" data-invoice-unit="${id}" maxlength="15" value="${escapeHtml(unit)}" aria-label="وحدة القياس" placeholder="الوحدة">`
                        : `<span class="invoice-unit-cell invoice-unit-label">${escapeHtml(unit)}</span>`}
                    </span>
                  </span>
                  <input type="number" min="0" step="any" inputmode="decimal" data-invoice-quantity="${id}" value="${escapeHtml(quantity)}" placeholder="الكمية" aria-label="الكمية">
                </div>
                <label class="invoice-field invoice-price-field">
                  <span class="invoice-price-heading">سعر الوحدة</span>
                  <span class="invoice-price-row">
                    <input class="invoice-price-input" type="number" min="0" step="any" inputmode="decimal" data-invoice-price="${id}" value="${escapeHtml(price)}" placeholder="السعر" aria-label="سعر الوحدة">
                    <span class="invoice-currency-cell">دولار</span>
                  </span>
                </label>
              </div>
              <div class="invoice-line-total">
                <strong data-invoice-total>—</strong>
                <small data-invoice-calculation>أدخل الكمية والسعر لحساب الإجمالي</small>
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
                  <strong class="invoice-option-price">${usdPrice === null ? 'يلزم سعر الصرف' : `${money(usdPrice)} $`}</strong>
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
    invoiceItems.forEach(({ id, name, unit, quantity, price, currencyCode }) => {
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
      card?.classList.toggle('is-incomplete', !isComplete)
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
          `<span>${money(total)} $</span>${settings.syriaEnabled && settings.exchangeRate > 0
            ? `<small>${money(total * settings.exchangeRate)} ليرة سورية</small>`
            : ''}`).join('')
        : '—'
      fitInvoiceSummaryText(netElement, 12, 6)
    }
    const unitTotals = invoicePanel.querySelector<HTMLUListElement>('[data-invoice-unit-totals]')
    if (unitTotals) {
      const displayedQuantities = aggregateInvoiceQuantities(invoiceItems
        .map((item) => ({
          unit: item.unit,
          quantity: item.quantity.trim() ? Number(item.quantity) : Number.NaN,
          amount: item.quantity.trim() && item.price.trim()
            ? Number(item.quantity) * Number(item.price)
            : null,
        })))
      unitTotals.innerHTML = displayedQuantities.map(({ unit, quantity, amount }) =>
        `<li>${invoiceQuantity(quantity)} ${escapeHtml(unit)} = ${amount === null ? 'قيمة غير مكتملة' : `${money(amount)} $`}</li>`).join('')
      fitInvoiceSummaryText(unitTotals, 12, 4)
    }
  }
  const collectInvoiceExportData = (): InvoiceExportData | null => {
    if (!invoiceItems.length) {
      showToast('أضف خدمة واحدة على الأقل قبل تصدير الفاتورة.')
      return null
    }
    const rows: InvoiceExportRow[] = []
    let invoiceTotal = 0
    for (const item of invoiceItems) {
      const name = item.name.trim()
      const unit = item.unit.trim()
      const notes = item.notes.trim()
      const quantityText = item.quantity.trim()
      const priceText = item.price.trim()
      if (name.length > 50) {
        showToast('يجب ألا يتجاوز اسم الخدمة 50 حرفًا.')
        return null
      }
      if (unit.length > 15) {
        showToast('يجب ألا تتجاوز وحدة القياس 15 حرفًا.')
        return null
      }
      if (notes.length > 35) {
        showToast('يجب ألا تتجاوز ملاحظة الخدمة 35 حرفًا.')
        return null
      }
      if (!name || !unit) {
        showToast('أكمل اسم الخدمة ووحدة القياس في جميع الخدمات.')
        return null
      }
      if (!quantityText || !priceText) {
        showToast('أكمل الكمية وسعر الوحدة في جميع الخدمات.')
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
      const row: InvoiceExportRow = { name, notes, quantity, unit, unitPrice, total: lineTotal }
      rows.push(row)
      invoiceTotal += lineTotal
    }
    const now = new Date()
    const exportDate = formatInvoiceDateTime(now)
    return {
      rows,
      unitTotals: aggregateInvoiceQuantities(rows.map(({ unit, quantity, total }) => ({
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
      customerNeighborhood: '',
      workshopName: '',
      responsibleTeacherName: accountProfile.name,
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
            <span>السعر الأساسي: ${money(service.price)} ${service.currencyCode === 'USD' ? '$' : escapeHtml(service.currencyCode)}</span>
          </div>
          <div class="export-price-field">
            <span>سعر التصدير</span>
            <span class="export-price-stepper">
              <button type="button" class="export-price-adjust export-price-increase" data-export-adjust="increase" data-service-id="${service.id}" aria-label="زيادة السعر ربع $" ${checked ? '' : 'disabled'}>▲</button>
              <span class="export-price-input-wrap">
                <span class="export-price-dollar" aria-hidden="true">$</span>
                <input type="number" min="0" step="0.25" data-export-price="${service.id}" value="${exportPrice}" ${checked ? '' : 'disabled'}>
              </span>
              <button type="button" class="export-price-adjust export-price-decrease" data-export-adjust="decrease" data-service-id="${service.id}" aria-label="إنقاص السعر ربع $" ${checked ? '' : 'disabled'}>▼</button>
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
          const sourceCustomerName = normalizeCustomerText(sourceRecord.customerName)
          const sourceCustomerPhone = normalizeCustomerPhone(sourceRecord.customerPhone)
          const sourceCustomerAddress = normalizeCustomerText(sourceRecord.customerAddress)
          const linkedCustomer = customers.find((customer) => customer.id === sourceRecord.customerId)
          const matchingCustomers = sourceCustomerName
            ? customers.filter((customer) =>
              normalizeCustomerText(customer.name) === sourceCustomerName
              && (!sourceCustomerPhone || normalizeCustomerPhone(customer.phone) === sourceCustomerPhone)
              && (!sourceCustomerAddress || normalizeCustomerText(customer.address) === sourceCustomerAddress))
            : []
          const matchingCustomer = matchingCustomers.length === 1 ? matchingCustomers[0] : undefined
          data.customerId = linkedCustomer?.id || matchingCustomer?.id || null
          data.customerName = sourceRecord.customerName
          data.customerPhone = sourceRecord.customerPhone
          data.customerAddress = sourceRecord.customerAddress
          data.customerNeighborhood = customers.find((customer) => customer.id === data.customerId)?.neighborhood || ''
          data.workshopName = sourceRecord.workshopName || ''
          data.responsibleTeacherName = sourceRecord.responsibleTeacherName || accountProfile.name
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
        const editableItems = invoiceItems.map(({ id, custom, name, notes, quantity, price, unit, unitCode, currencyCode }) => ({
          id,
          custom,
          name,
          notes,
          quantity,
          price,
          unit,
          unitCode,
          currencyCode,
        }))
        if (sourceRecord) {
          const paidTotal = getInvoicePaidTotal(sourceRecord)
          const correctionNet = data.total - (sourceRecord.discount?.amount || 0)
          if (options?.correction && paidTotal - correctionNet > 0.00001) {
            showToast(`لا يمكن حفظ التصحيح لأن إجمالي الدفعات المسجلة (${money(paidTotal)} $) أكبر من صافي الفاتورة بعد التعديل (${money(Math.max(0, correctionNet))} $). عدّل البنود/الأسعار أو قلّل الدفعات أولًا.`)
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
            onInvoiceSaved: options?.correction
              ? () => {
                element.remove()
                activeMainSection = 'invoices'
                renderActiveSection()
                window.setTimeout(() => {
                  document.querySelectorAll<HTMLDivElement>('.modal-backdrop').forEach((backdrop) => {
                    if (backdrop.querySelector('.invoice-history-modal')) backdrop.remove()
                  })
                  renderInvoiceVersionsDialog(sourceRecord.rootId)
                }, 200)
              }
              : undefined,
          })
          exportDialogOpening = false
          if (exportButton.isConnected) exportButton.disabled = false
        } else {
          void getInvoiceNumberCandidate(ownerId).then((invoiceNumber) => {
            if (!element.isConnected || dataUserId !== ownerId) return
            data.invoiceNumber = invoiceNumber
            openInvoiceCustomerExportDialog(data, ownerId, {
              sourceRecord,
              editableItems,
              payments: savePayments,
              mode: 'export-save',
              onInvoiceSaved: () => {
                element.remove()
                activeMainSection = 'invoices'
                renderActiveSection()
              },
            })
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
    const removeButton = event.target.closest<HTMLButtonElement>('[data-invoice-remove]')
    if (removeButton) {
      const itemId = Number(removeButton.dataset.invoiceRemove)
      const itemIndex = invoiceItems.findIndex((line) => line.id === itemId)
      if (itemIndex < 0) return
      invoiceItems.splice(itemIndex, 1)
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
        showToast('أدخل سعر الصرف لتحويل سعر الخدمة إلى ال$.')
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
  element.querySelector('#cancel-export-services')!.addEventListener('click', () => element.remove())
  element.querySelector('#continue-export-services')!.addEventListener('click', () => {
    const rows = getRows()
    if (!rows.length) {
      showToast('اختر خدمة واحدة على الأقل قبل متابعة التجهيز.')
      return
    }
    element.hidden = true
    openServicesExportDialog(rows, element)
  })
}

async function loadSettings(user: User, ownerId: string, sessionId: number) {
  settings = loadCachedSettings(ownerId)
  try {
    const userRef = doc(db, 'users', ownerId)
    const snapshot = await getDoc(userRef)
    const remoteData = snapshot.exists() ? snapshot.data() : {}
    const loaded = snapshot.exists() ? safeSettings(remoteData) : safeSettings(defaultSettings)
    saveCachedSettings(ownerId, loaded)
    if (currentUser?.uid === user.uid && dataUserId === ownerId && authSessionId === sessionId) {
      settings = loaded
    }
    if (!Array.isArray(remoteData.measurementUnits)
      && currentUser?.uid === user.uid && dataUserId === ownerId && authSessionId === sessionId) {
      try {
        await setDoc(userRef, { measurementUnits: loaded.measurementUnits }, { merge: true })
      } catch (migrationError) {
        console.error('Failed to initialize measurement units:', migrationError)
        showToast(`تعذر حفظ وحدات القياس الأساسية: ${friendlyError(migrationError)}`)
      }
    }
  } catch {
    /* Keep the local settings cache. */
  }
}

async function loadAccountProfile(user: User, ownerId: string, sessionId: number) {
  const fallback = accountProfileForUser(user, null)
  accountProfile = fallback
  accountProfileReady = false
  try {
    const snapshot = await getDoc(doc(db, 'users', ownerId, 'accountProfiles', user.uid))
    if (currentUser?.uid !== user.uid || dataUserId !== ownerId || authSessionId !== sessionId) return
    if (accountProfileReady) return
    accountProfile = snapshot.exists() ? accountProfileForUser(user, snapshot.data()) : fallback
    accountProfileReady = true
  } catch (loadError) {
    if (currentUser?.uid !== user.uid || dataUserId !== ownerId || authSessionId !== sessionId) return
    if (!accountProfileReady) {
      accountProfile = fallback
      accountProfileReady = true
      console.error('Failed to load account profile:', loadError)
      showToast(`تعذر تحميل بيانات الحساب: ${friendlyError(loadError)}`)
    }
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
    accountProfile = user ? accountProfileForUser(user, null) : { name: '', phone: '' }
    accountProfileReady = false
    unsubscribeServices()
    unsubscribeCustomers()
    unsubscribeInvoices()
    unsubscribeServices = () => undefined
    unsubscribeCustomers = () => undefined
    unsubscribeInvoices = () => undefined
    workServices = []
    customers = []
    invoiceRecords = []
    customerListView = 'active'
    invoicesLoaded = false
    activeMainSection = 'services'
    if (!user) {
      document.querySelectorAll<HTMLElement>('.modal-backdrop').forEach((backdrop) => backdrop.remove())
      settings = defaultSettings
      applyTheme(true)
      renderAuth()
      return
    }
    await Promise.all([
      loadSettings(user, ownerId, sessionId),
      loadAccountProfile(user, ownerId, sessionId),
    ])
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
      updateCustomerDeleteAvailability()
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
      invoicesLoaded = true
      updateCustomerDeleteAvailability()
      if (activeMainSection === 'customers') renderCustomersSection()
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
