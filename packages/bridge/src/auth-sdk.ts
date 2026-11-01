// Browser-bundle entry. Exposed on window.ByokySDK by the IIFE build
// (see tsup.config.ts). The connect page loads the bundle via <script>
// and connects with ByokySDK.connectCovering, which drives ByokySDK.Byoky's
// ConnectModal flow.
export { Byoky } from '@byoky/sdk';
export { connectCovering } from './page-session.js';
