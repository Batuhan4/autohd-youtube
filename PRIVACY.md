# Privacy policy for AutoHD for YouTube™

**Last updated:** 21 August 2026

AutoHD is a Chrome extension that locks YouTube™ playback quality to the option you pick. It is open source ([MIT](LICENSE)) and has no backend.

This policy describes what the extension handles, including data that never leaves your browser.

## Who we are

The publisher is the AutoHD project at [github.com/Batuhan4/autohd-youtube](https://github.com/Batuhan4/autohd-youtube). The extension does not have a company server, analytics vendor, or account system.

## What AutoHD stores

Only two values, both chosen by you in the toolbar popup:

| Value | Meaning | Default |
| --- | --- | --- |
| `quality` | Auto, Highest, Lowest, or a fixed rung (2160p–144p) | Auto |
| `enabled` | On or Off | On |

They are saved with Chrome’s `storage.sync` API so the same choice can follow a signed-in Chrome profile to your other devices. Google operates that sync as part of Chrome. **The AutoHD publisher cannot read these values.** We do not run a server that receives them.

You can change or clear them at any time: pick another quality, turn the switch Off, or remove the extension.

## What AutoHD reads on YouTube

On `youtube.com` watch pages only, a content script talks to YouTube’s player so it can:

- read the qualities that video actually offers
- apply the quality you selected (or restore Auto when you choose Auto or turn AutoHD off)

That player information is used in memory to pick a matching quality. It is not stored, and it is not sent to the publisher or to anyone else.

AutoHD does not run on other websites. It does not inject into YouTube embeds on other sites.

## What AutoHD does not collect

AutoHD does not collect, transmit, or sell:

- name, email, phone, or other identity data
- account credentials, cookies, or authentication tokens
- watch history, search history, or browsing history
- video titles, page URLs, or page HTML (beyond calling the player’s quality APIs on youtube.com)
- location, health, financial, or payment data
- analytics, advertising identifiers, or crash reports

There is no remote code, no third-party script, and no network request from the extension to a developer-controlled host.

## How the data is used (limited use)

The stored preference is used for one purpose: applying your chosen YouTube playback quality, or leaving YouTube in control when the extension is Off or set to Auto.

It is not used for advertising, profiling, or any other product. It is not transferred to other parties except:

- Chrome sync, if you are signed into Chrome (operated by Google, not by AutoHD)
- when required by law

No human at AutoHD can read your preference, because it never reaches us.

## Permissions

| Permission | Why |
| --- | --- |
| `storage` | Save quality and the On/Off switch. |
| Content scripts on `youtube.com`, `www.youtube.com`, and `m.youtube.com` | Apply that choice to the YouTube player. |

The extension does not request `tabs`, `<all_urls>`, cookies, history, or host access outside YouTube.

## Security

There is no AutoHD server to breach. Settings stay in Chrome storage on your device (and in Chrome sync if you use it). The store package contains all extension code; nothing is downloaded at runtime.

## Children

AutoHD is not directed at children and does not knowingly collect personal information from anyone.

## Changes

If this policy changes, it will be updated in this file with a new date. The live copy is always this document in the public repository.

## Contact

Open an issue: [github.com/Batuhan4/autohd-youtube/issues](https://github.com/Batuhan4/autohd-youtube/issues)

YouTube is a trademark of Google LLC. AutoHD is not affiliated with YouTube or Google.
