// Browser-bundle entry. Exposed on window.ByokySDK by the IIFE build
// (see tsup.config.ts). The connect page loads the bundle via <script>
// and uses ByokySDK.Byoky to drive the ConnectModal flow.
export { Byoky } from '@byoky/sdk';
