module.exports = function (config) {
  config.set({
    basePath: '..',
    frameworks: ['mocha', 'karma-typescript'],
    reporters: ['mocha', 'karma-typescript'],
    client: {
      mocha: {
        timeout : 10000, // 10 seconds - upped from 2 seconds
        retries: 3 // Allow for slow server on CI.
      }
    },
    files: [
      { pattern: "tests/src/**/*.ts" },
      { pattern: "src/**/*.ts" }
    ],
    preprocessors: {
      '**/*.ts': ['karma-typescript']
    },
    port: 9876,
    colors: true,
    singleRun: !config.debug,
    browserNoActivityTimeout: 30000,
    failOnEmptyTestSuite: true,
    logLevel: config.LOG_INFO,


    karmaTypescriptConfig: {
      tsconfig: 'tests/tsconfig.json',
      coverageOptions: {
        instrumentation: !config.debug
      },
      bundlerOptions: {
        sourceMap: true,
        acornOptions: {
          ecmaVersion: 8,
        },
        transforms: [
          require("karma-typescript-es6-transform")({
            presets: [
              ["env", {
                targets: {
                  browsers: ["last 2 Chrome versions"]
                },
              }]
            ]
          })
        ]
      }
    }
  });
};
