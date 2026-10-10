import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isBlockedAddress } from './net-guard.js';

test('private, loopback, link-local, shared and reserved IPv4 addresses are blocked', () => {
  for (const address of [
    '0.0.0.0',
    '10.0.0.1',
    '10.255.255.255',
    '100.64.0.1',
    '100.127.255.254',
    '127.0.0.1',
    '127.1.2.3',
    '169.254.169.254',
    '172.16.0.1',
    '172.31.255.255',
    '192.0.0.8',
    '192.0.2.10',
    '192.168.1.1',
    '198.18.0.1',
    '198.19.255.255',
    '198.51.100.7',
    '203.0.113.9',
    '224.0.0.1',
    '240.0.0.1',
    '255.255.255.255',
  ]) {
    assert.equal(isBlockedAddress(address), true, address);
  }
});

test('public IPv4 addresses are allowed, including the edges of the private ranges', () => {
  for (const address of [
    '8.8.8.8',
    '1.1.1.1',
    '100.63.255.255',
    '100.128.0.1',
    '172.15.0.1',
    '172.32.0.1',
    '203.0.114.1',
    '223.255.255.254',
  ]) {
    assert.equal(isBlockedAddress(address), false, address);
  }
});

test('IPv6 loopback, unique-local, link-local, mapped, NAT64, documentation and multicast are blocked', () => {
  for (const address of [
    '::',
    '::1',
    'fc00::1',
    'fd12:3456:789a::1',
    'fe80::1',
    'fe80::1%eth0',
    'ff02::1',
    '::ffff:127.0.0.1',
    '::ffff:7f00:1',
    '::ffff:8.8.8.8',
    '64:ff9b::808:808',
    '2001:db8::1',
    '2001::1',
    '2002:7f00:1::',
    '2002:0a00:1::1',
    '3fff::1',
  ]) {
    assert.equal(isBlockedAddress(address), true, address);
  }
});

test('public IPv6 addresses are allowed', () => {
  for (const address of ['2606:4700:4700::1111', '2a00:1450:4001:81b::200e', '2002:0808:0808::1']) {
    assert.equal(isBlockedAddress(address), false, address);
  }
});

test('anything that is not an IP address is blocked', () => {
  for (const value of [
    '',
    'localhost',
    'example.com',
    '1.2.3',
    '999.1.1.1',
    '1.2.3.4.5',
    '::g',
    '0x7f.0.0.1',
    '017700000001',
  ]) {
    assert.equal(isBlockedAddress(value), true, value);
  }
});
