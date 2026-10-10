// Lets `node --test` load the app's TypeScript modules, whose relative imports leave out the `.ts`
// extension as the bundler allows. Node strips the types itself.
import { registerHooks } from 'node:module';

registerHooks({
  resolve(specifier, context, next) {
    try {
      return next(specifier, context);
    } catch (e) {
      const relative = /^\.{1,2}\//.test(specifier), hasExt = /\.[cm]?[jt]sx?$/.test(specifier);
      if (e?.code !== 'ERR_MODULE_NOT_FOUND' || !relative || hasExt) throw e;
      return next(specifier + '.ts', context);
    }
  },
});
