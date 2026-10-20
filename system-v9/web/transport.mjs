// UI port. A verified session adapter must be installed before live use.
// This file does not collect credentials or implement the blocked server/authentication work.
export function createTransport(adapter){
 return {connected:!!adapter,async call(action,data={}){if(!adapter||typeof adapter.call!=='function')throw Error('backend_not_connected');return adapter.call(action,data);}};
}
