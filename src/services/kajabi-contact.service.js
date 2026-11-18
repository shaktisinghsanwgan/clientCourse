import { env } from '../config/env.js';
import { ApiError } from '../utils/errors.js';
import { isKajabiApiConfigured, kajabiPublicRequest } from './kajabi.service.js';

const FIELD_TITLES = {
  partnerName: ['Partner Name'],
  partnerId: ['Partner Id'],
  partnerEmail: ['Partner Email'],
  signupStatus: ['Partner Signup Status', 'Signup Status'],
  purchaserName: ['Purchaser Name'],
  purchaserId: ['Purchaser Id'],
  purchaserEmail: ['Purchaser Email'],
};

const DEFAULT_HANDLES = {
  partnerEmail: 'custom_5',
  partnerName: 'custom_6',
  partnerId: 'custom_7',
  purchaserName: 'custom_8',
  purchaserId: 'custom_9',
  purchaserEmail: 'custom_10',
  signupStatus: 'custom_11',
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

function titleHandle(discovered, key) {
  const titles = FIELD_TITLES[key] || [];
  for (let index = 0; index < titles.length; index += 1) {
    const handle = discovered.get(titles[index].toLowerCase());
    if (handle) return handle;
  }
  return '';
}

async function handlesFor(keys) {
  const needsLookup = keys.some((key) => !configuredHandle(key));
  const discovered = needsLookup ? await customFieldsByTitle() : new Map();
  const handles = {};
  const missing = [];
  keys.forEach((key) => {
    const titles = FIELD_TITLES[key] || [key];
    handles[key] = configuredHandle(key) || titleHandle(discovered, key) || DEFAULT_HANDLES[key] || '';
    if (!handles[key]) missing.push(titles[0]);
  });
  if (missing.length > 0) {
    const available = [...discovered.keys()].join(', ') || 'none';
    console.error(`Kajabi custom fields not found: ${missing.join(', ')}. Available: ${available}`);
  }
  return handles;
}

async function contactFromCustomer(customerId) {
  const id = String(customerId || '').trim();
  if (!id) return null;
  const body = await kajabiPublicRequest('GET', `/v1/customers/${encodeURIComponent(id)}`, {
    query: { include: 'contact' },
    missingOk: true,
  });
  const contactId = body?.data?.relationships?.contact?.data?.id;
  if (!contactId) return null;
  return { id: String(contactId), customerId: id };
}

async function searchContact(email, siteId) {
  const query = {
    'filter[search]': email,
    'page[size]': 10,
  };
  if (siteId) query['filter[site_id]'] = siteId;
  const body = await kajabiPublicRequest('GET', '/v1/contacts', { query });
  const matches = (Array.isArray(body?.data) ? body.data : []).filter((row) => {
    return String(row?.attributes?.email || '').trim().toLowerCase() === email && row?.id;
  });
  if (matches.length !== 1) return null;
  const contact = matches[0];
  const customerId = contact.relationships?.customer?.data?.id
    ? String(contact.relationships.customer.data.id)
    : '';
  return { id: String(contact.id), customerId };
}

async function findContact(email, kajabiId) {
  const fromCustomer = await contactFromCustomer(kajabiId);
  if (fromCustomer) return fromCustomer;
  const normalized = String(email || '').trim().toLowerCase();
  if (!normalized) return null;
  const scoped = await searchContact(normalized, env.KAJABI_SITE_ID);
  if (scoped || !env.KAJABI_SITE_ID) return scoped;
  return searchContact(normalized, '');
}

async function personId(email, kajabiId) {
  const contact = await findContact(email, kajabiId);
  if (contact?.customerId) return contact.customerId;
  if (kajabiId) return String(kajabiId);
  if (contact?.id) return contact.id;
  return '';
}

async function writeContact(email, kajabiId, values, handles) {
  const contact = await findContact(email, kajabiId);
  if (!contact) {
    console.error(`Kajabi contact not found for ${email}`);
    return false;
  }
  const attributes = {};
  Object.entries(values).forEach(([key, value]) => {
    if (value === undefined || value === null || value === '') return;
    if (!handles[key]) return;
    attributes[handles[key]] = String(value);
  });
  if (Object.keys(attributes).length === 0) {
    console.error(`Kajabi contact ${contact.id} was not updated because the custom fields are missing`);
    return false;
  }
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

export async function saveWeekRatingContact({ email, kajabiId, role, weekNumber, rating }) {
  if (!isKajabiApiConfigured()) {
    throw new ApiError(503, 'Kajabi API is not configured', 'KAJABI_API_NOT_CONFIGURED');
  }
  const roleLabel = role === 'PRIMARY' ? 'Purchaser' : 'Partner';
  const title = `Week ${weekNumber} Rating ${roleLabel}`;
  const discovered = await customFieldsByTitle();
  const handle = discovered.get(title.toLowerCase());
  if (!handle) {
    throw new ApiError(502, `Kajabi custom field "${title}" was not found`, 'KAJABI_FIELD_MISSING');
  }
  const updated = await writeContact(email, kajabiId, { rating: String(rating) }, { rating: handle });
  if (!updated) {
    throw new ApiError(404, 'Kajabi contact was not found for this account', 'IDENTITY_NOT_FOUND');
  }
  return { field: title, handle, rating: String(rating) };
}

const PORTAL_FIELD_TITLE = 'Partner Rating & Attachment URL';

export async function savePortalUrlContact({ email, kajabiId, portalUrl }) {
  if (!isKajabiApiConfigured()) {
    throw new ApiError(503, 'Kajabi API is not configured', 'KAJABI_API_NOT_CONFIGURED');
  }
  const url = String(portalUrl || '').trim();
  if (!url) {
    throw new ApiError(400, 'Portal URL is required', 'VALIDATION_ERROR');
  }
  let handle = env.KAJABI_CONTACT_FIELD_PORTAL_URL;
  if (!handle) {
    const discovered = await customFieldsByTitle();
    handle = discovered.get(PORTAL_FIELD_TITLE.toLowerCase()) || '';
  }
  if (!handle) {
    throw new ApiError(502, `Kajabi custom field "${PORTAL_FIELD_TITLE}" was not found`, 'KAJABI_FIELD_MISSING');
  }
  const contact = await findContact(email, kajabiId);
  if (!contact) {
    throw new ApiError(404, 'Kajabi contact was not found for this account', 'IDENTITY_NOT_FOUND');
  }
  await kajabiPublicRequest('PATCH', `/v1/contacts/${encodeURIComponent(contact.id)}`, {
    body: {
      data: {
        type: 'contacts',
        id: contact.id,
        attributes: { [handle]: url },
      },
    },
  });
  return { field: PORTAL_FIELD_TITLE, handle, contactId: contact.id };
}

export async function syncInvitedPartnerContact(input) {
  if (!isKajabiApiConfigured()) return { updated: false };
  try {
    const handles = await handlesFor(['partnerName', 'partnerId', 'partnerEmail', 'signupStatus']);
    const partnerId = await personId(input.partnerEmail, '');
    const updated = await writeContact(input.purchaserEmail, input.purchaserKajabiId, {
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
      purchaser = await writeContact(input.purchaserEmail, input.purchaserKajabiId, {
        partnerName: input.partnerName,
        partnerId,
        partnerEmail: input.partnerEmail,
        signupStatus: SIGNED_UP,
      }, handles);
    } catch (error) {
      skipped(error, 'purchaser');
    }
    try {
      partner = await writeContact(input.partnerEmail, input.partnerKajabiId, {
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
