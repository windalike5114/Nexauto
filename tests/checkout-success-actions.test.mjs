import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import vm from 'node:vm';
import { createRequire } from 'node:module';

// Execute the real component and its effects with browser storage/event spies.
const bundle = await build({
  entryPoints: ['components/checkout-success-actions.tsx'], bundle: true, write: false,
  platform: 'node', format: 'cjs', jsx: 'automatic', external: ['react/jsx-runtime'],
  plugins: [{ name: 'component-boundaries', setup(builder) {
    builder.onResolve({ filter: /^(react|next\/link|next\/navigation|lucide-react|\.\/cart-provider|@\/)/ }, args => args.path === 'react/jsx-runtime' ? {path:args.path,external:true} : { path: args.path, namespace: 'boundary' });
    builder.onLoad({ filter: /.*/, namespace: 'boundary' }, ({path}) => ({ contents:
      path === 'react' ? `export const useEffect = effect => globalThis.effects.push(effect);
        export const useRef = value => ({current:value});
        export const useState = value => [value, () => {}];` :
      path === './cart-provider' ? `export const useCart = () => ({clearCart: () => globalThis.clears++});` :
      path === 'next/navigation' ? `export const useRouter = () => ({push: () => {}});` :
      path === 'next/link' ? `export default function Link() { return null; }` :
      path === 'lucide-react' ? `export const CheckCircle = () => null; export const Loader2 = CheckCircle; export const UserPlus = CheckCircle;` :
      `export const getSafeAuthErrorMessage = () => ''; export const getAuthCallbackUrl = () => ''; export const getFirstValidationMessage = () => ''; export const parseSignUpInput = x => x; export const createClient = () => ({});`
    }));
  }}]
});

function mount(paymentConfirmed) {
  const storage = new Map([['nexauto-cart', '[{"sku":"WPFP1222","qty":1}]']]);
  const events = [];
  const context = vm.createContext({
    module:{exports:{}}, require:createRequire(import.meta.url), effects:[], clears:0,
    Event: class { constructor(type) { this.type = type; } },
    window:{localStorage:{setItem:(key,value)=>storage.set(key,value)},dispatchEvent:event=>events.push(event.type)}
  });
  vm.runInContext(bundle.outputFiles[0].text, context);
  const rendered = context.module.exports.CheckoutSuccessActions({paymentConfirmed,customerEmail:'',customerName:'',signedIn:true});
  for (const effect of context.effects) effect();
  return {context,storage,events,rendered};
}

test('unconfirmed payment renders no success actions and preserves the cart without completion events', () => {
  const {context,storage,events,rendered} = mount(false);
  assert.equal(rendered,null);
  assert.equal(context.clears,0);
  assert.match(storage.get('nexauto-cart'),/WPFP1222/);
  assert.deepEqual(events,[]);
});

test('server-confirmed payment renders success actions and clears cart exactly once, including effect replay', () => {
  const {context,storage,events,rendered} = mount(true);
  for (const effect of context.effects) effect();
  assert.ok(rendered);
  assert.equal(context.clears,1);
  assert.equal(storage.get('nexauto-cart'),'[]');
  assert.deepEqual(events,['nexauto:checkout-complete']);
});
