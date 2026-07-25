// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
    modules: ['@wraith-protocol/sdk-nuxt'],

    // sdk-nuxt module options (all optional)
    wraithSdk: {
        prefix: '',
    },

    typescript: {
        strict: true,
    },
});
