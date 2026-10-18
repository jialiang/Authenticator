<template>
  <a
    role="button"
    data-x-role="entry"
    v-bind:tabindex="tabindex"
    v-bind:class="{
      entry: true,
      pinnedEntry: entry.pinned,
      'no-copy': noCopy(entry.code),
    }"
    v-on:click="copyCode(entry)"
    v-on:keydown.enter="copyCode(entry)"
  >
    <div class="deleteAction" v-on:click="removeEntry(entry)">
      <IconMinusCircle />
    </div>
    <div
      class="sector"
      v-if="entry.type !== OTPType.hotp && entry.type !== OTPType.hhex"
      v-show="sectorStart"
    >
      <svg viewBox="0 0 16 16">
        <circle
          cx="8"
          cy="8"
          r="4"
          v-bind:style="{
            animationDuration: entry.period + 's',
            animationDelay: (sectorOffset % entry.period) + 's',
          }"
        />
      </svg>
    </div>
    <div
      v-bind:class="{ counter: true, disabled: style.hotpDiabled }"
      v-if="entry.type === OTPType.hotp || entry.type === OTPType.hhex"
      v-on:click="nextCode(entry)"
    >
      <IconRedo />
    </div>
    <div class="issuer">
      {{
        entry.issuer.split("::")[0] +
        (theme === "compact" ? ` (${entry.account})` : "")
      }}
    </div>
    <div class="issuerEdit">
      <input
        v-bind:placeholder="i18n.issuer"
        type="text"
        v-model="entry.issuer"
        v-on:change="entry.update(encryption)"
      />
    </div>
    <div
      v-bind:class="{
        code: true,
        hotp: entry.type === OTPType.hotp || entry.type === OTPType.hhex,
        timeout: entry.period - (second % entry.period) < 5,
      }"
      v-html="style.isEditing ? showBulls(entry) : showCode(entry.code)"
    ></div>
    <div class="issuer account">{{ entry.account }}</div>
    <div class="issuerEdit">
      <input
        v-bind:placeholder="i18n.accountName"
        type="text"
        v-model="entry.account"
        v-on:change="entry.update(encryption)"
      />
    </div>
    <div
      class="showqr"
      v-if="shouldShowQrIcon(entry)"
      v-on:click.stop="showQr(entry)"
    >
      <IconQr />
    </div>
    <div class="pin" v-on:click.stop="pin(entry)">
      <IconPin />
    </div>
  </a>
</template>
<script lang="ts">
import Vue from "vue";
import { mapState } from "vuex";
import * as QRGen from "qrcode-generator";
import { OTPEntry, OTPType, CodeState, OTPAlgorithm } from "../../models/otp";
import { EntryStorage } from "../../models/storage";
import { getCurrentTab, okToInjectContentScript } from "../../utils";

import IconMinusCircle from "../../../svg/minus-circle.svg";
import IconRedo from "../../../svg/redo.svg";
import IconQr from "../../../svg/qrcode.svg";
import IconPin from "../../../svg/pin.svg";

const computedPrototype = [
  mapState("accounts", [
    "OTPType",
    "sectorStart",
    "sectorOffset",
    "second",
    "encryption",
  ]),
  mapState("style", ["style"]),
  mapState("menu", ["theme"]),
];

let computed = {};

for (const module of computedPrototype) {
  Object.assign(computed, module);
}

export default Vue.extend({
  computed,
  props: {
    entry: OTPEntry,
    tabindex: Number,
  },
  methods: {
    noCopy(code: string) {
      return (
        code === CodeState.Encrypted ||
        code === CodeState.Invalid ||
        code.startsWith("&bull;")
      );
    },
    shouldShowQrIcon(entry: OTPEntry) {
      return (
        !this.$store.state.menu.exportDisabled &&
        entry.secret !== null &&
        entry.type !== OTPType.battle &&
        entry.type !== OTPType.steam
      );
    },
    showCode(code: string) {
      if (code === CodeState.Encrypted) {
        return this.i18n.encrypted;
      } else if (code === CodeState.Invalid) {
        return this.i18n.invalid;
      } else {
        return code;
      }
    },
    showBulls(entry: OTPEntry) {
      if (entry.code === CodeState.Encrypted) {
        return this.i18n.encrypted;
      } else if (entry.code === CodeState.Invalid) {
        return this.i18n.invalid;
      }

      if (entry.code.startsWith("&bull;")) {
        return entry.code;
      }

      return new Array(entry.digits).fill("&bull;").join("");
    },
    async removeEntry(entry: OTPEntry) {
      if (
        await this.$store.dispatch(
          "notification/confirm",
          this.i18n.confirm_delete
        )
      ) {
        await entry.delete();
        await this.$store.dispatch("accounts/deleteCode", entry.hash);
      }
      return;
    },
    async pin(entry: OTPEntry) {
      this.$store.commit("accounts/pinEntry", entry);
      await EntryStorage.set(this.$store.state.accounts.entries);
      const codesEl = document.getElementById("codes") as HTMLDivElement;
      codesEl.scrollTop = 0;
    },
    showQr(entry: OTPEntry) {
      this.$store.commit("qr/setQr", getQrUrl(entry));
      this.$store.commit("style/showQr");
      return;
    },
    async nextCode(entry: OTPEntry) {
      if (this.$store.state.style.hotpDisabled) {
        return;
      }
      this.$store.commit("style/toggleHotpDisabled");
      await entry.next();
      setTimeout(() => {
        this.$store.commit("style/toggleHotpDisabled");
      }, 3000);
      return;
    },
    async copyCode(entry: OTPEntry) {
      if (
        this.$store.state.style.style.isEditing ||
        entry.code === CodeState.Invalid ||
        entry.code.startsWith("&bull;")
      ) {
        return;
      }

      if (entry.code === CodeState.Encrypted) {
        this.$store.commit("style/showInfo", true);
        this.$store.commit("currentView/changeView", "EnterPasswordPage");
        return;
      }

      const codeClipboard = document.getElementById(
        "codeClipboard"
      ) as HTMLInputElement;
      if (!codeClipboard) {
        return;
      }

      if (this.$store.state.menu.useAutofill && (await insertContentScript())) {
        const tab = await getCurrentTab();
        if (tab && tab.id) {
          chrome.tabs.sendMessage(tab.id, {
            action: "pastecode",
            code: entry.code,
          });
        }
      }

      // Copying after the awaits above, once the click no longer counts as
      // recent, relies on the clipboardWrite permission in the manifest
      const lastActiveElement = document.activeElement as HTMLElement;
      codeClipboard.value = entry.code;
      codeClipboard.focus();
      codeClipboard.select();
      document.execCommand("Copy");
      lastActiveElement.focus();
      this.$store.dispatch("notification/ephermalMessage", this.i18n.copied);
    },
  },
  components: {
    IconMinusCircle,
    IconRedo,
    IconQr,
    IconPin,
  },
});

// TODO: move most of this to a models file and reuse for backup stuff
function getQrUrl(entry: OTPEntry) {
  const label = entry.issuer
    ? entry.issuer + ":" + entry.account
    : entry.account;
  const type =
    entry.type === OTPType.hex
      ? OTPType[OTPType.totp]
      : entry.type === OTPType.hhex
      ? OTPType[OTPType.hotp]
      : OTPType[entry.type];
  const otpauth =
    "otpauth://" +
    type +
    "/" +
    encodeURIComponent(label) +
    "?secret=" +
    entry.secret +
    (entry.issuer
      ? "&issuer=" + encodeURIComponent(entry.issuer.split("::")[0])
      : "") +
    (entry.type === OTPType.hotp || entry.type === OTPType.hhex
      ? "&counter=" + entry.counter
      : "") +
    (entry.type === OTPType.totp && entry.period !== 30
      ? "&period=" + entry.period
      : "") +
    (entry.digits !== 6 ? "&digits=" + entry.digits : "") +
    (entry.algorithm !== OTPAlgorithm.SHA1
      ? "&algorithm=" + OTPAlgorithm[entry.algorithm]
      : "");
  const qr = QRGen(0, "L");
  qr.addData(otpauth);
  qr.make();
  return qr.createDataURL(5);
}

// Browsers block extensions on some pages (Firefox on its own account and
// add-on sites, for example), so injecting can fail. Report that instead of
// throwing, so the caller can still copy the code.
async function insertContentScript() {
  const tab = await getCurrentTab();
  if (!okToInjectContentScript(tab)) {
    return false;
  }

  try {
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ["/dist/content.js"],
    });
    await chrome.scripting.insertCSS({
      target: { tabId: tab.id },
      files: ["/css/content.css"],
    });
  } catch (error) {
    console.warn("Could not inject the autofill script:", error);
    return false;
  }

  return true;
}
</script>
