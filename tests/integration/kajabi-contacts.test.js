import { beforeEach, describe, expect, it } from 'vitest';
import { resetKajabiContactCache } from '../../src/services/kajabi-contact.service.js';
import {
  JANE,
  JOHN,
  linkJane,
  mockKajabi,
  registerPurchaser,
  signIn,
} from '../helpers.js';

function json(body, status = 200) {
  return {
    ok: status < 400,
    status,
    json: async () => body,
  };
}

function contactRecord(person, contactId) {
  return {
    id: contactId,
    type: 'contacts',
    attributes: { name: person.name, email: person.email },
    relationships: {
      customer: { data: { id: person.id, type: 'customers' } },
    },
  };
}

const CONTACTS = [
  contactRecord(JOHN, 'c-john'),
  contactRecord(JANE, 'c-jane'),
];

const CUSTOM_FIELDS = {
  data: [
    { id: '5', type: 'custom_fields', attributes: { handle: 'custom_5', title: 'Partner Email' } },
    { id: '6', type: 'custom_fields', attributes: { handle: 'custom_6', title: 'Partner Name' } },
    { id: '7', type: 'custom_fields', attributes: { handle: 'custom_7', title: 'Partner Id' } },
    { id: '8', type: 'custom_fields', attributes: { handle: 'custom_8', title: 'Purchaser Name' } },
    { id: '9', type: 'custom_fields', attributes: { handle: 'custom_9', title: 'Purchaser Id' } },
    { id: '10', type: 'custom_fields', attributes: { handle: 'custom_10', title: 'Purchaser Email' } },
    { id: '11', type: 'custom_fields', attributes: { handle: 'custom_11', title: 'Partner Signup Status' } },
  ],
  meta: { total_pages: 1, total_count: 7, current_page: 1 },
};

function installContactMock(patches, fields = CUSTOM_FIELDS) {
  mockKajabi([JOHN, { ...JANE, paid: false }]);
  const baseFetch = global.fetch;
  global.fetch = async (url, init = {}) => {
    const parsed = new URL(String(url));
    if (parsed.pathname.endsWith('/v1/custom_fields')) {
      return json(fields);
    }
    if (parsed.pathname.includes('/v1/contacts/')) {
      patches.push({
        method: init.method,
        contentType: init.headers['Content-Type'],
        body: JSON.parse(init.body),
      });
      return json({ data: { id: parsed.pathname.split('/').pop(), type: 'contacts' } });
    }
    if (parsed.pathname.endsWith('/v1/contacts')) {
      const email = (parsed.searchParams.get('filter[search]') || '').toLowerCase();
      return json({ data: CONTACTS.filter((contact) => contact.attributes.email === email) });
    }
    return baseFetch(url, init);
  };
}

describe('Kajabi contact custom fields', () => {
  beforeEach(() => {
    resetKajabiContactCache();
  });

  it('saves partner details on invite and both contacts after signup', async () => {
    const patches = [];
    installContactMock(patches);
    const registration = await registerPurchaser(JOHN);
    expect(registration.status).toBe(201);
    const john = await signIn(JOHN.email);

    const linked = await linkJane(john.token);
    expect(linked.status).toBe(200);
    expect(linked.body.data.status).toBe('PENDING');
    expect(patches).toHaveLength(1);
    expect(patches[0].contentType).toBe('application/vnd.api+json');
    expect(patches[0].body).toEqual({
      data: {
        type: 'contacts',
        id: 'c-john',
        attributes: {
          custom_6: 'Jane Doe',
          custom_7: 'kajabi_456',
          custom_5: 'jane@example.com',
          custom_11: 'Not signed up',
        },
      },
    });

    const jane = await signIn(JANE.email);
    expect(jane.user.role).toBe('PARTNER');
    expect(patches).toHaveLength(3);
    expect(patches[1].body.data).toEqual({
      type: 'contacts',
      id: 'c-john',
      attributes: {
        custom_6: 'Jane Doe',
        custom_7: 'kajabi_456',
        custom_5: 'jane@example.com',
        custom_11: 'Signed up',
      },
    });
    expect(patches[2].body.data).toEqual({
      type: 'contacts',
      id: 'c-jane',
      attributes: {
        custom_8: 'John Doe',
        custom_9: 'kajabi_123',
        custom_10: 'john@example.com',
        custom_11: 'Signed up',
      },
    });
  });

  it('uses the Kajabi field handles when the field list is empty', async () => {
    const patches = [];
    installContactMock(patches, { data: [], meta: { total_pages: 1, total_count: 0, current_page: 1 } });
    const registration = await registerPurchaser(JOHN);
    expect(registration.status).toBe(201);
    const john = await signIn(JOHN.email);
    const linked = await linkJane(john.token);
    expect(linked.status).toBe(200);
    expect(patches[0].body.data.attributes).toEqual({
      custom_6: 'Jane Doe',
      custom_7: 'kajabi_456',
      custom_5: 'jane@example.com',
      custom_11: 'Not signed up',
    });
  });

  it('still links the partner when Kajabi contact update fails', async () => {
    mockKajabi([JOHN, { ...JANE, paid: false }]);
    const registration = await registerPurchaser(JOHN);
    expect(registration.status).toBe(201);
    const john = await signIn(JOHN.email);
    const linked = await linkJane(john.token);
    expect(linked.status).toBe(200);
    expect(linked.body.data.partnerEmail).toBe(JANE.email);

    const jane = await signIn(JANE.email);
    expect(jane.user.role).toBe('PARTNER');
    expect(jane.partnership.status).toBe('ACTIVE');
  });
});
