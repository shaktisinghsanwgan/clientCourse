import { env } from '../config/env.js';
import { ApiError } from '../utils/errors.js';

const TIMEOUT_MS = 8000;
const MAX_ATTEMPTS = 3;

let tokenCache = { accessToken: '', expiresAt: 0 };

export function resetKajabiCache() {
  tokenCache = { accessToken: '', expiresAt: 0 };
}

export function isKajabiApiConfigured() {
  return Boolean(env.KAJABI_API_BASE_URL && env.KAJABI_API_KEY && env.KAJABI_API_SECRET);
}

export function kajabiIntegrationStatus() {
  return {
    apiConfigured: isKajabiApiConfigured(),
    webhookConfigured: Boolean(env.KAJABI_WEBHOOK_SECRET),
    mode: isKajabiApiConfigured() ? 'official_api' : 'email_confirmation',
  };
}

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function kajabiFetch(url, options, attempt = 1) {
  try {
    const response = await fetch(url, {
      ...options,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });

    if ((response.status >= 500 || response.status === 429) && attempt < MAX_ATTEMPTS) {
      await sleep(200 * attempt);
      return kajabiFetch(url, options, attempt + 1);
    }

    return response;
  } catch (error) {
    if (attempt < MAX_ATTEMPTS) {
      await sleep(200 * attempt);
      return kajabiFetch(url, options, attempt + 1);
    }
    console.error(`Kajabi request failed for ${options.method || 'GET'} ${url.pathname || ''}`);
    throw new ApiError(502, 'Kajabi integration failure', 'KAJABI_INTEGRATION_FAILURE');
  }
}

async function getAccessToken(forceRefresh = false) {
  if (!forceRefresh && tokenCache.accessToken && tokenCache.expiresAt > Date.now()) {
    return tokenCache.accessToken;
  }

  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: env.KAJABI_API_KEY,
    client_secret: env.KAJABI_API_SECRET,
  });

  const response = await kajabiFetch(new URL(`${env.KAJABI_API_BASE_URL}/v1/oauth/token`), {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body,
  });

  if (!response.ok) {
    console.error(`Kajabi token request failed with status ${response.status}`);
    throw new ApiError(502, 'Kajabi integration failure', 'KAJABI_INTEGRATION_FAILURE');
  }

  const payload = await response.json();
  if (!payload.access_token) {
    throw new ApiError(502, 'Kajabi integration failure', 'KAJABI_INTEGRATION_FAILURE');
  }

  const expiresIn = Number(payload.expires_in || 3600);
  tokenCache = {
    accessToken: payload.access_token,
    expiresAt: Date.now() + Math.max(30, expiresIn - 60) * 1000,
  };
  return tokenCache.accessToken;
}

async function kajabiGet(path, query, allowRetry = true) {
  const url = new URL(`${env.KAJABI_API_BASE_URL}${path}`);
  Object.entries(query).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') {
      url.searchParams.set(key, String(value));
    }
  });

  const token = await getAccessToken();
  const response = await kajabiFetch(url, {
    method: 'GET',
    headers: {
      Accept: 'application/vnd.api+json',
      Authorization: `Bearer ${token}`,
    },
  });

  if (response.status === 401 && allowRetry) {
    resetKajabiCache();
    await getAccessToken(true);
    return kajabiGet(path, query, false);
  }

  if (!response.ok) {
    console.error(`Kajabi GET ${path} failed with status ${response.status}`);
    throw new ApiError(502, 'Kajabi integration failure', 'KAJABI_INTEGRATION_FAILURE');
  }

  return response.json();
}

function exactCustomer(records, email) {
  return records.filter((record) => {
    const recordEmail = String(record?.attributes?.email || '').trim().toLowerCase();
    return recordEmail === email && record?.id;
  });
}

export function offerIdOf(purchase) {
  const single = purchase?.relationships?.offer?.data?.id;
  if (single) {
    return String(single);
  }
  const many = purchase?.relationships?.offers?.data;
  if (Array.isArray(many) && many[0]?.id) {
    return String(many[0].id);
  }
  return '';
}

export async function verifyPurchaseByEmail(email, expectedCustomerId) {
  if (!isKajabiApiConfigured()) {
    return { configured: false, customer: null, paid: false, purchaseId: null, offerId: null };
  }

  const customerQuery = {
    'filter[search]': email,
    'fields[customers]': 'name,email',
    'page[size]': 10,
  };
  if (env.KAJABI_SITE_ID) {
    customerQuery['filter[site_id]'] = env.KAJABI_SITE_ID;
  }

  const customerBody = await kajabiGet('/v1/customers', customerQuery);
  const matches = exactCustomer(Array.isArray(customerBody?.data) ? customerBody.data : [], email);

  if (matches.length > 1) {
    throw new ApiError(409, 'Conflicting Kajabi identity', 'IDENTITY_CONFLICT');
  }

  if (matches.length === 0) {
    return { configured: true, customer: null, paid: false, purchaseId: null, offerId: null };
  }

  const customer = {
    id: String(matches[0].id),
    email,
    name: matches[0].attributes?.name || '',
  };

  if (expectedCustomerId && String(expectedCustomerId) !== customer.id) {
    throw new ApiError(409, 'Conflicting Kajabi identity', 'IDENTITY_CONFLICT');
  }

  const purchaseQuery = {
    'filter[customer_id]': customer.id,
    'filter[active]': 'true',
    'page[size]': 20,
  };
  if (env.KAJABI_SITE_ID) {
    purchaseQuery['filter[site_id]'] = env.KAJABI_SITE_ID;
  }

  const purchaseBody = await kajabiGet('/v1/purchases', purchaseQuery);
  const purchases = (Array.isArray(purchaseBody?.data) ? purchaseBody.data : [])
    .filter((purchase) => !purchase?.attributes?.deactivated_at);

  const matched = env.KAJABI_OFFER_ID
    ? purchases.filter((purchase) => offerIdOf(purchase) === env.KAJABI_OFFER_ID)
    : purchases;

  if (env.KAJABI_OFFER_ID && matched.length === 0) {
    return { configured: true, customer, paid: false, purchaseId: null, offerId: null };
  }

  const purchase = matched[0];
  return {
    configured: true,
    customer,
    paid: Boolean(purchase),
    purchaseId: purchase?.id ? String(purchase.id) : null,
    offerId: purchase ? offerIdOf(purchase) || null : null,
  };
}

export function extractPurchaseWebhook(body) {
  const items = Array.isArray(body?.payload) ? body.payload : [];
  const customer = items.find((item) => item?.type === 'customers');
  const purchase = items.find((item) => item?.type === 'purchases');
  const offer = items.find((item) => item?.type === 'offers');
  return {
    event: body?.event || '',
    customerId: customer?.id ? String(customer.id) : '',
    email: String(customer?.attributes?.email || '').trim().toLowerCase(),
    name: customer?.attributes?.name || '',
    purchaseId: purchase?.id ? String(purchase.id) : '',
    offerId: offer?.id ? String(offer.id) : '',
  };
}
