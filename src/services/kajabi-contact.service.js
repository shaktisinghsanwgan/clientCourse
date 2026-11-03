import { env } from '../config/env.js';
import { isKajabiApiConfigured, kajabiPublicRequest } from './kajabi.service.js';

const FIELD_TITLES = {
  partnerName: 'Partner Name',
  partnerId: 'Partner Id',
  partnerEmail: 'Partner Email',
  signupStatus: 'Signup Status',
  purchaserName: 'Purchaser Name',
  purchaserId: 'Purchaser Id',
  purchaserEmail: 'Purchaser Email',
};

const NOT_SIGNED_UP = 'Not signed up';
const SIGNED_UP = 'Signed up';

let fieldCache = { expiresAt: 0, byTitle: null };

export function resetKajabiContactCache() {
  fieldCache = { expiresAt: 0, byTitle: null };
}

function configuredHandle(key) {
  const values = {
    partnerName: env.KAJABI_CONTACT_FIELD_PARTNER_NAME,
    partnerId: env.KAJABI_CONTACT_FIELD_PARTNER_ID,
    partnerEmail: env.KAJABI_CONTACT_FIELD_PARTNER_EMAIL,
    signupStatus: env.KAJABI_CONTACT_FIELD_SIGNUP_STATUS,
    purchaserName: env.KAJABI_CONTACT_FIELD_PURCHASER_NAME,
    purchaserId: env.KAJABI_CONTACT_FIELD_PURCHASER_ID,
    purchaserEmail: env.KAJABI_CONTACT_FIELD_PURCHASER_EMAIL,
  };
  return values[key] || '';
}

async function customFieldsByTitle() {
  if (fieldCache.byTitle && fieldCache.expiresAt > Date.now()) {
    return fieldCache.byTitle;
  }

  const byTitle = new Map();
  for (let page = 1; page <= 5; page += 1) {
    const query = {
      'page[number]': page,
      'page[size]': 100,
      'fields[custom_fields]': 'handle,title',
    };
    if (env.KAJABI_SITE_ID) query['filter[site_id]'] = env.KAJABI_SITE_ID;
    const body = await kajabiPublicRequest('GET', '/v1/custom_fields', { query });
    const rows = Array.isArray(body?.data) ? body.data : [];
    rows.forEach((row) => {
      const title = String(row?.attributes?.title || '').trim().toLowerCase();
      const handle = String(row?.attributes?.handle || '').trim();
      if (title && handle && !row?.attributes?.archived) byTitle.set(title, handle);
    });
    const totalPages = Number(body?.meta?.total_pages || 1);
    if (page >= totalPages || rows.length === 0) break;
  }

  fieldCache = { byTitle, expiresAt: Date.now() + 10 * 60 * 1000 };
  return byTitle;
}

async function handlesFor(keys) {
  const needsLookup = keys.some((key) => !configuredHandle(key));
  const discovered = needsLookup ? await customFieldsByTitle() : new Map();
  const handles = {};
  const missing = [];
  keys.forEach((key) => {
    handles[key] = configuredHandle(key) || discovered.get(FIELD_TITLES[key].toLowerCase()) || '';
    if (!handles[key]) missing.push(FIELD_TITLES[key]);
  });
  if (missing.length > 0) {
    console.error(`Kajabi custom fields not found: ${missing.join(', ')}`);
  }
  return handles;
}

async function findContact(email) {
  const normalized = String(email || '').trim().toLowerCase();
  if (!normalized) return null;
  const query = {
    'filter[search]': normalized,
    'page[size]': 10,
    include: 'customer',
  };
  if (env.KAJABI_SITE_ID) query['filter[site_id]'] = env.KAJABI_SITE_ID;
  const body = await kajabiPublicRequest('GET', '/v1/contacts', { query });
  const matches = (Array.isArray(body?.data) ? body.data : []).filter((row) => {
    return String(row?.attributes?.email || '').trim().toLowerCase() === normalized && row?.id;
  });
  if (matches.length !== 1) return null;
  const contact = matches[0];
  const customerId = contact.relationships?.customer?.data?.id
    ? String(contact.relationships.customer.data.id)
    : '';
  return { id: String(contact.id), customerId };
}

async function personId(email, kajabiId) {
  const contact = await findContact(email);
  if (contact?.customerId) return contact.customerId;
  if (kajabiId) return String(kajabiId);
  if (contact?.id) return contact.id;
  return '';
}

async function writeContact(email, values, handles) {
  const contact = await findContact(email);
  if (!contact) return false;
  const attributes = {};
  Object.entries(values).forEach(([key, value]) => {
    if (value === undefined || value === null || value === '') return;
    if (!handles[key]) return;
    attributes[handles[key]] = String(value);
  });
  if (Object.keys(attributes).length === 0) return false;
  await kajabiPublicRequest('PATCH', `/v1/contacts/${encodeURIComponent(contact.id)}`, {
    body: {
      data: {
        type: 'contacts',
        id: contact.id,
        attributes,
      },
    },
  });
  return true;
}

function skipped(error, label) {
  console.error(`Kajabi ${label} contact update skipped`, error instanceof Error ? error.message : error);
  return { updated: false };
}

export async function syncInvitedPartnerContact(input) {
  if (!isKajabiApiConfigured()) return { updated: false };
  try {
    const handles = await handlesFor(['partnerName', 'partnerId', 'partnerEmail', 'signupStatus']);
    const partnerId = await personId(input.partnerEmail, '');
    const updated = await writeContact(input.purchaserEmail, {
      partnerName: input.partnerName,
      partnerId,
      partnerEmail: input.partnerEmail,
      signupStatus: input.signedUp ? SIGNED_UP : NOT_SIGNED_UP,
    }, handles);
    return { updated };
  } catch (error) {
    return skipped(error, 'purchaser');
  }
}

export async function syncSignedUpPartnerContacts(input) {
  if (!isKajabiApiConfigured()) return { purchaser: false, partner: false };
  let purchaser = false;
  let partner = false;
  try {
    const handles = await handlesFor([
      'partnerName',
      'partnerId',
      'partnerEmail',
      'signupStatus',
      'purchaserName',
      'purchaserId',
      'purchaserEmail',
    ]);
    const partnerId = await personId(input.partnerEmail, input.partnerKajabiId);
    const purchaserId = await personId(input.purchaserEmail, input.purchaserKajabiId);
    try {
      purchaser = await writeContact(input.purchaserEmail, {
        partnerName: input.partnerName,
        partnerId,
        partnerEmail: input.partnerEmail,
        signupStatus: SIGNED_UP,
      }, handles);
    } catch (error) {
      skipped(error, 'purchaser');
    }
    try {
      partner = await writeContact(input.partnerEmail, {
        purchaserName: input.purchaserName,
        purchaserId,
        purchaserEmail: input.purchaserEmail,
        signupStatus: SIGNED_UP,
      }, handles);
    } catch (error) {
      skipped(error, 'partner');
    }
  } catch (error) {
    skipped(error, 'signup');
  }
  return { purchaser, partner };
}
