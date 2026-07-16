// 代码块首屏仅注册常用语法；完整语言表在打开语言选择器时加载。
import arduino from 'highlight.js/lib/languages/arduino';
import bash from 'highlight.js/lib/languages/bash';
import c from 'highlight.js/lib/languages/c';
import cpp from 'highlight.js/lib/languages/cpp';
import csharp from 'highlight.js/lib/languages/csharp';
import css from 'highlight.js/lib/languages/css';
import diff from 'highlight.js/lib/languages/diff';
import go from 'highlight.js/lib/languages/go';
import java from 'highlight.js/lib/languages/java';
import javascript from 'highlight.js/lib/languages/javascript';
import json from 'highlight.js/lib/languages/json';
import markdown from 'highlight.js/lib/languages/markdown';
import plaintext from 'highlight.js/lib/languages/plaintext';
import python from 'highlight.js/lib/languages/python';
import rust from 'highlight.js/lib/languages/rust';
import shell from 'highlight.js/lib/languages/shell';
import sql from 'highlight.js/lib/languages/sql';
import typescript from 'highlight.js/lib/languages/typescript';
import xml from 'highlight.js/lib/languages/xml';
import yaml from 'highlight.js/lib/languages/yaml';
import { createLowlight } from 'lowlight';

export const codeBlockLowlight = createLowlight({
  arduino,
  bash,
  c,
  cpp,
  csharp,
  css,
  diff,
  go,
  java,
  javascript,
  json,
  markdown,
  plaintext,
  python,
  rust,
  shell,
  sql,
  typescript,
  xml,
  yaml,
});

type CodeBlockLanguageModule = {
  default: Parameters<typeof codeBlockLowlight.register>[1];
};

const codeBlockLanguageLoaders: Record<
  string,
  () => Promise<CodeBlockLanguageModule>
> = {
  basic: () => import('highlight.js/lib/languages/basic'),
  bnf: () => import('highlight.js/lib/languages/bnf'),
  clojure: () => import('highlight.js/lib/languages/clojure'),
  coffeescript: () => import('highlight.js/lib/languages/coffeescript'),
  coq: () => import('highlight.js/lib/languages/coq'),
  dart: () => import('highlight.js/lib/languages/dart'),
  dockerfile: () => import('highlight.js/lib/languages/dockerfile'),
  ebnf: () => import('highlight.js/lib/languages/ebnf'),
  elixir: () => import('highlight.js/lib/languages/elixir'),
  elm: () => import('highlight.js/lib/languages/elm'),
  erlang: () => import('highlight.js/lib/languages/erlang'),
  fortran: () => import('highlight.js/lib/languages/fortran'),
  fsharp: () => import('highlight.js/lib/languages/fsharp'),
  gherkin: () => import('highlight.js/lib/languages/gherkin'),
  glsl: () => import('highlight.js/lib/languages/glsl'),
  graphql: () => import('highlight.js/lib/languages/graphql'),
  groovy: () => import('highlight.js/lib/languages/groovy'),
  haskell: () => import('highlight.js/lib/languages/haskell'),
  kotlin: () => import('highlight.js/lib/languages/kotlin'),
  latex: () => import('highlight.js/lib/languages/latex'),
  less: () => import('highlight.js/lib/languages/less'),
  lisp: () => import('highlight.js/lib/languages/lisp'),
  livescript: () => import('highlight.js/lib/languages/livescript'),
  llvm: () => import('highlight.js/lib/languages/llvm'),
  lua: () => import('highlight.js/lib/languages/lua'),
  makefile: () => import('highlight.js/lib/languages/makefile'),
  mathematica: () => import('highlight.js/lib/languages/mathematica'),
  matlab: () => import('highlight.js/lib/languages/matlab'),
  nix: () => import('highlight.js/lib/languages/nix'),
  objectivec: () => import('highlight.js/lib/languages/objectivec'),
  ocaml: () => import('highlight.js/lib/languages/ocaml'),
  perl: () => import('highlight.js/lib/languages/perl'),
  php: () => import('highlight.js/lib/languages/php'),
  powershell: () => import('highlight.js/lib/languages/powershell'),
  prolog: () => import('highlight.js/lib/languages/prolog'),
  protobuf: () => import('highlight.js/lib/languages/protobuf'),
  r: () => import('highlight.js/lib/languages/r'),
  reasonml: () => import('highlight.js/lib/languages/reasonml'),
  ruby: () => import('highlight.js/lib/languages/ruby'),
  scala: () => import('highlight.js/lib/languages/scala'),
  scheme: () => import('highlight.js/lib/languages/scheme'),
  scss: () => import('highlight.js/lib/languages/scss'),
  smalltalk: () => import('highlight.js/lib/languages/smalltalk'),
  swift: () => import('highlight.js/lib/languages/swift'),
  vbnet: () => import('highlight.js/lib/languages/vbnet'),
  verilog: () => import('highlight.js/lib/languages/verilog'),
  vhdl: () => import('highlight.js/lib/languages/vhdl'),
  wasm: () => import('highlight.js/lib/languages/wasm'),
  x86asm: () => import('highlight.js/lib/languages/x86asm'),
};

const languagePromises = new Map<string, Promise<boolean>>();

export const isCodeBlockLanguageLoaded = (language: string | null | undefined) =>
  Boolean(language && codeBlockLowlight.registered(language));

export function loadCodeBlockLanguage(language: string) {
  if (
    language === 'auto' ||
    language === 'plaintext' ||
    isCodeBlockLanguageLoaded(language)
  ) {
    return Promise.resolve(true);
  }

  const existingPromise = languagePromises.get(language);
  if (existingPromise) return existingPromise;

  const loader = codeBlockLanguageLoaders[language];
  if (!loader) return Promise.resolve(false);

  const promise = loader().then((module) => {
    codeBlockLowlight.register(language, module.default);
    return true;
  });

  languagePromises.set(language, promise);
  return promise;
}
