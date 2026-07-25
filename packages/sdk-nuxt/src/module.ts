import { defineNuxtModule, addImports, createResolver } from '@nuxt/kit';

export interface ModuleOptions {
    /**
     * Prefix for auto-imported composables.
     * Set to '' to disable prefix.
     * @default ''
     */
    prefix?: string;
}

export default defineNuxtModule<ModuleOptions>({
    meta: {
        name: '@wraith-protocol/sdk-nuxt',
        configKey: 'wraithSdk',
        compatibility: {
            nuxt: '>=3.0.0',
        },
    },

    defaults: {
        prefix: '',
    },

    setup(options, nuxt) {
        const { resolve } = createResolver(import.meta.url);
        const prefix = options.prefix ?? '';

        // Ensure sdk-vue composables (which wrap @wraith-protocol/sdk) are
        // transpiled rather than bundled as-is by Nitro on the server.
        nuxt.options.build.transpile ??= [];
        nuxt.options.build.transpile.push('@wraith-protocol/sdk-nuxt');
        nuxt.options.build.transpile.push('@wraith-protocol/sdk-vue');

        const composables = [
            'useWraith',
            'useStellarStealthKeys',
            'useEvmStealthKeys',
            'useSolanaStealthKeys',
            'useStealthMetaAddress',
            'useScanner',
        ];

        addImports(
            composables.map((name) => ({
                name,
                as: `${prefix}${name}`,
                from: resolve('./runtime/composables'),
            })),
        );
    },
});
