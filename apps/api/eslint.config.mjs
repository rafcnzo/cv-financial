import tseslint from 'typescript-eslint';
export default tseslint.config({files:['src/**/*.ts'],languageOptions:{parser:tseslint.parser}}, {files:['src/core/**/*.ts','src/ports/**/*.ts'],rules:{'no-restricted-imports':['error',{patterns:['**/adapters/**','cloudflare:*','hono','postgres','drizzle-orm','drizzle-orm/*']}]}});
