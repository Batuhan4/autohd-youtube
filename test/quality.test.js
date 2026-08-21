'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const AutoHD = require('../quality.js');

test('exposes auto, highest, fixed rungs, and lowest', () => {
  assert.equal(AutoHD.OPTIONS.length, 10);
  assert.deepEqual(
    AutoHD.OPTIONS.map((option) => option.id),
    ['auto', 'highest', 'hd2160', 'hd1440', 'hd1080', 'hd720', 'large', 'medium', 'tiny', 'lowest']
  );
});

test('defaults to Auto with the extension on', () => {
  assert.equal(AutoHD.DEFAULT_QUALITY, 'auto');
  assert.equal(AutoHD.DEFAULT_ENABLED, true);
  assert.equal(AutoHD.shouldForce('auto'), false);
  assert.equal(AutoHD.shouldForce('highest'), true);
});

test('picks the highest available quality', () => {
  const available = [
    { id: 'tiny', height: 144 },
    { id: 'hd1080', height: 1080 },
    { id: 'hd720', height: 720 }
  ];
  assert.equal(AutoHD.pickQuality('highest', available), 'hd1080');
});

test('picks the lowest available quality', () => {
  const available = [
    { id: 'hd1080', height: 1080 },
    { id: 'hd720', height: 720 },
    { id: 'tiny', height: 144 }
  ];
  assert.equal(AutoHD.pickQuality('lowest', available), 'tiny');
});

test('auto does not force a rendition', () => {
  const available = [
    { id: 'hd1080', height: 1080 },
    { id: 'tiny', height: 144 }
  ];
  assert.equal(AutoHD.pickQuality('auto', available), null);
});

test('falls back to the next lower available quality', () => {
  const available = [
    { id: 'hd720', height: 720 },
    { id: 'large', height: 480 },
    { id: 'medium', height: 360 }
  ];
  assert.equal(AutoHD.pickQuality('hd1080', available), 'hd720');
});

test('uses an exact match when it exists', () => {
  const available = [
    { id: 'hd1080', height: 1080 },
    { id: 'tiny', height: 144 }
  ];
  assert.equal(AutoHD.pickQuality('tiny', available), 'tiny');
});

test('uses the lowest available quality when every option is higher', () => {
  const available = [
    { id: 'hd1080', height: 1080 },
    { id: 'hd720', height: 720 }
  ];
  assert.equal(AutoHD.pickQuality('tiny', available), 'hd720');
});

test('ignores auto and unplayable levels', () => {
  const available = [
    { id: 'auto' },
    { id: 'hd2160', height: 2160, playable: false },
    { id: 'hd1080', height: 1080, playable: true }
  ];
  assert.equal(AutoHD.pickQuality('highest', available), 'hd1080');
});

test('reads height from quality labels', () => {
  const available = [
    { id: 'hd1080', label: '1080p60' },
    { id: 'hd720', label: '720p' }
  ];
  assert.equal(AutoHD.pickQuality('hd2160', available), 'hd1080');
});

test('returns null when nothing is playable', () => {
  assert.equal(AutoHD.pickQuality('hd1080', []), null);
  assert.equal(AutoHD.pickQuality('highest', [{ id: 'auto' }]), null);
  assert.equal(AutoHD.pickQuality('lowest', []), null);
});

test('accepts only known option ids', () => {
  assert.equal(AutoHD.isOptionId('hd1080'), true);
  assert.equal(AutoHD.isOptionId('highest'), true);
  assert.equal(AutoHD.isOptionId('auto'), true);
  assert.equal(AutoHD.isOptionId('lowest'), true);
  assert.equal(AutoHD.isOptionId(''), false);
});

test('treats missing enabled as on', () => {
  assert.equal(AutoHD.isEnabledValue(true), true);
  assert.equal(AutoHD.isEnabledValue(undefined), true);
  assert.equal(AutoHD.isEnabledValue(false), false);
  assert.equal(AutoHD.isEnabledValue('0'), false);
});
