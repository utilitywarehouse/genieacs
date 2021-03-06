import * as path from "path";
import * as fs from "fs";
import { promisify } from "util";
import { rollup, WarningHandler } from "rollup";
import rollupReplace from "rollup-plugin-replace";
import rollupJson from "rollup-plugin-json";
import typescript from "rollup-plugin-typescript";
import { terser } from "rollup-plugin-terser";
import webpack from "webpack";
import postcss from "postcss";
import postcssImport from "postcss-import";
import postcssCssNext from "postcss-cssnext";
import cssnano from "cssnano";

const MODE = process.env["NODE_ENV"] || "production";

const BUILD_METADATA = new Date()
  .toISOString()
  .split(".")[0]
  .replace(/[^0-9]/g, "");

const INPUT_DIR = path.resolve(__dirname, "..");
const OUTPUT_DIR = path.resolve(__dirname, "../dist");

const externals = [
  "path",
  "fs",
  "cluster",
  "os",
  "http",
  "https",
  "zlib",
  "crypto",
  "mongodb",
  "libxmljs",
  "vm",
  "later",
  "parsimmon",
  "seedrandom",
  "querystring",
  "child_process",
  "dgram",
  "url",
  "koa",
  "koa-router",
  "koa-compress",
  "koa-bodyparser",
  "koa-jwt",
  "koa-static",
  "jsonwebtoken",
  "stream",
  "mithril",
  "parsimmon",
  "codemirror",
  "codemirror/mode/javascript/javascript",
  "codemirror/mode/yaml/yaml"
];

function rmDirSync(dirPath): void {
  if (!fs.existsSync(dirPath)) return;
  const files = fs.readdirSync(dirPath);

  for (const file of files) {
    const filePath = `${dirPath}/${file}`;
    if (fs.statSync(filePath).isFile()) fs.unlinkSync(filePath);
    else rmDirSync(filePath);
  }
  fs.rmdirSync(dirPath);
}

async function init(): Promise<void> {
  // Delete any old output directory
  rmDirSync(OUTPUT_DIR);

  // Create output directory layout
  fs.mkdirSync(OUTPUT_DIR);
  fs.mkdirSync(OUTPUT_DIR + "/bin");
  fs.mkdirSync(OUTPUT_DIR + "/config");
  fs.mkdirSync(OUTPUT_DIR + "/debug");
  fs.mkdirSync(OUTPUT_DIR + "/public");
  fs.mkdirSync(OUTPUT_DIR + "/tools");

  // Create package.json
  const packageJson = JSON.parse(
    fs.readFileSync(path.resolve(INPUT_DIR, "package.json")).toString()
  );
  delete packageJson["devDependencies"];
  packageJson["scripts"] = {
    install: packageJson["scripts"].install,
    configure: packageJson["scripts"].configure
  };
  packageJson["version"] = `${packageJson["version"]}+${BUILD_METADATA}`;
  fs.writeFileSync(
    path.resolve(OUTPUT_DIR, "package.json"),
    JSON.stringify(packageJson, null, 4)
  );
}

async function copyStatic(): Promise<void> {
  const files = [
    "LICENSE",
    "README.md",
    "CHANGELOG.md",
    "npm-shrinkwrap.json",
    "config/config-sample.json",
    "config/ext-sample.js",
    "public/logo.svg",
    "public/favicon.png"
  ];

  for (const file of files) {
    fs.copyFileSync(
      path.resolve(INPUT_DIR, file),
      path.resolve(OUTPUT_DIR, file)
    );
  }
}

async function generateCss(): Promise<void> {
  const cssInPath = path.resolve(INPUT_DIR, "ui/css/app.css");
  const cssOutPath = path.resolve(OUTPUT_DIR, "public/app.css");
  const cssIn = fs.readFileSync(cssInPath);
  const cssOut = await postcss([
    postcssImport,
    postcssCssNext({ warnForDuplicates: false }),
    cssnano
  ]).process(cssIn, { from: cssInPath, to: cssOutPath });
  fs.writeFileSync(cssOutPath, cssOut.css);
}

async function generateToolsJs(): Promise<void> {
  for (const bin of ["configure-ui", "dump-data-model"]) {
    const inputFile = path.resolve(INPUT_DIR, `tools/${bin}`);
    const outputFile = path.resolve(OUTPUT_DIR, `tools/${bin}`);
    const bundle = await rollup({
      input: inputFile,
      external: externals,
      acorn: {
        allowHashBang: true
      },
      plugins: [
        rollupReplace({
          delimiters: ["", ""],
          "#!/usr/bin/env -S node -r esm -r ts-node/register/transpile-only": ""
        }),
        typescript({
          tsconfig: "./tsconfig.json",
          include: [`tools/${bin}`, "lib/**/*.ts"]
        }),
        MODE === "production" ? terser() : null
      ]
    });

    await bundle.write({
      format: "cjs",
      preferConst: true,
      banner: "#!/usr/bin/env node",
      file: outputFile
    });

    // Mark as executable
    const mode = fs.statSync(outputFile).mode;
    fs.chmodSync(outputFile, mode | 73);
  }
}

async function generateBackendJs(): Promise<void> {
  for (const bin of [
    "genieacs-cwmp",
    "genieacs-ext",
    "genieacs-nbi",
    "genieacs-fs",
    "genieacs-ui"
  ]) {
    const inputFile = path.resolve(INPUT_DIR, `bin/${bin}`);
    const outputFile = path.resolve(OUTPUT_DIR, `bin/${bin}`);
    const bundle = await rollup({
      input: inputFile,
      external: externals,
      acorn: {
        allowHashBang: true
      },
      treeshake: {
        propertyReadSideEffects: false,
        pureExternalModules: true
      },
      plugins: [
        rollupReplace({
          delimiters: ["", ""],
          "#!/usr/bin/env -S node -r esm -r ts-node/register/transpile-only": ""
        }),
        rollupJson({ preferConst: true }),
        {
          resolveId: (importee, importer) => {
            if (importee.endsWith("/package.json")) {
              const p = path.resolve(path.dirname(importer), importee);
              if (p === path.resolve(INPUT_DIR, "package.json"))
                return path.resolve(OUTPUT_DIR, "package.json");
            }
            return null;
          }
        },
        typescript({
          tsconfig: "./tsconfig.json",
          include: [`bin/${bin}`, "lib/**/*.ts"]
        }),
        MODE === "production" ? terser() : null
      ]
    });

    await bundle.write({
      format: "cjs",
      preferConst: true,
      banner: "#!/usr/bin/env node",
      file: outputFile
    });

    // Mark as executable
    const mode = fs.statSync(outputFile).mode;
    fs.chmodSync(outputFile, mode | 73);
  }
}

async function generateFrontendJs(): Promise<void> {
  const inputFile = path.resolve(INPUT_DIR, "ui/app.ts");
  const outputFile = path.resolve(OUTPUT_DIR, "public/app.js");

  const bundle = await rollup({
    input: inputFile,
    external: externals,
    plugins: [
      rollupJson({ preferConst: true }),
      typescript({ tsconfig: "./tsconfig.json" })
    ],
    inlineDynamicImports: true,
    treeshake: {
      propertyReadSideEffects: false,
      pureExternalModules: true
    },
    onwarn: ((warning, warn) => {
      // Ignore circular dependency warnings
      if (warning.code !== "CIRCULAR_DEPENDENCY") warn(warning);
    }) as WarningHandler
  });

  await bundle.write({
    preferConst: true,
    format: "esm",
    file: outputFile
  });

  const webpackConf = {
    mode: MODE,
    entry: outputFile,
    resolve: {
      aliasFields: ["module"]
    },
    output: {
      path: path.resolve(OUTPUT_DIR, "public"),
      filename: "app.js"
    }
  };

  const stats = await promisify(webpack)(webpackConf);
  process.stdout.write(stats.toString({ colors: true }) + "\n");
}

init()
  .then(() => {
    Promise.all([
      copyStatic(),
      generateCss(),
      generateToolsJs(),
      generateBackendJs(),
      generateFrontendJs()
    ])
      .then(() => {})
      .catch(err => {
        process.stderr.write(err.stack + "\n");
      });
  })
  .catch(err => {
    process.stderr.write(err.stack + "\n");
  });
