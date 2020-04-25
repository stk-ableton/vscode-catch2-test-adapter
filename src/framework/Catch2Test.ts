import { TestEvent } from 'vscode-test-adapter-api';
import * as xml2js from 'xml2js';
import { AbstractTest } from '../AbstractTest';
import { inspect } from 'util';
import { TestEventBuilder } from '../TestEventBuilder';
import * as pathlib from 'path';
import { Version } from '../Util';
import { Suite } from '../Suite';
import { AbstractRunnable } from '../AbstractRunnable';
import { LoggerWrapper } from '../LoggerWrapper';

interface SharedWithCatch2Test {
  log: LoggerWrapper;
}

interface XmlObject {
  [prop: string]: any; //eslint-disable-line
}

export class Catch2Section {
  public constructor(name: string, file: string | undefined, line: number) {
    this.name = name;
    this.filename = file ? pathlib.normalize(file) : undefined;
    this.line = line;
  }

  public readonly name: string;
  public readonly filename: string | undefined;
  public readonly line: number;
  public readonly children: Catch2Section[] = [];
  public failed = false;

  public get escapedName(): string {
    // some debug adapter on ubuntu starts debug session in shell,
    // this prevents the SECTION("`pwd`") to be executed
    return this.name.replace(/`/g, '\\`');
  }
}

const EscapeCharParserFix = new Version(2, 11, 4);

export class Catch2Test extends AbstractTest {
  public constructor(
    shared: SharedWithCatch2Test,
    runnable: AbstractRunnable,
    parent: Suite,
    frameworkVersion: Version,
    testNameAsId: string,
    tags: string[],
    file: string | undefined,
    line: number | undefined,
    description: string | undefined,
    old?: Catch2Test | undefined,
  ) {
    const badChars = [
      // this 3 relates some catch2 bug
      '[',
      '\\',
      ',',
      // this two has some on windows
      '±',
      '§',
    ];
    const forceIgnoreEvent: TestEvent | undefined =
      frameworkVersion.smaller(EscapeCharParserFix) && badChars.some(b => testNameAsId.indexOf(b) != -1)
        ? ({
            type: 'test',
            test: '',
            state: 'errored',
            message: [
              '⚡️ This extension is unable to run this test.',
              '',
              `Current Catch2 framework version ${frameworkVersion} has a bug (https://github.com/catchorg/Catch2/issues/1905).`,
              `Update your framework to at least ${EscapeCharParserFix}.`,
              'Avoid test names with:',
              ...badChars.map(b => ` - ${b}`),
            ].join('\n'),
            description: '⚡️ Run me for details ⚡️',
            decorations: [
              {
                line: line,
                message: 'Invalid character in test name. Check the output.',
              },
            ],
          } as TestEvent)
        : undefined;

    super(
      shared,
      runnable,
      parent,
      old ? old.id : undefined,
      testNameAsId,
      testNameAsId,
      file,
      line,
      tags.some((v: string) => v.startsWith('.') || v == 'hide' || v == '!hide') || testNameAsId.startsWith('./'),
      forceIgnoreEvent,
      tags,
      description,
      undefined,
      undefined,
    );

    this._sections = old ? old.sections : undefined;
  }

  public get testNameInOutput(): string {
    // xml output trimmes the name of the test
    return this.testName.trim();
  }

  private _sections: undefined | Catch2Section[];

  public get sections(): undefined | Catch2Section[] {
    return this._sections;
  }

  public getEscapedTestName(): string {
    /* ',' and '[' has special meaning */
    return this.testName.replace('\\', '\\\\').replace(/,/g, '\\,').replace(/\[/g, '\\[');
  }

  public parseAndProcessTestCase(
    output: string,
    rngSeed: number | undefined,
    timeout: number | null,
    stderr: string | undefined,
  ): TestEvent {
    if (timeout !== null) {
      const ev = this.getTimeoutEvent(timeout);
      this.lastRunEvent = ev;
      return ev;
    }

    let res: XmlObject = {};
    new xml2js.Parser({ explicitArray: true }).parseString(output, (err: Error, result: XmlObject) => {
      if (err) {
        throw Error(inspect(err));
      } else {
        res = result;
      }
    });

    const testEventBuilder = new TestEventBuilder(this);

    if (rngSeed) testEventBuilder.appendMessage(`🔀 Randomness seeded to: ${rngSeed.toString()}`, 0);

    this._processXmlTagTestCaseInner(res.TestCase, testEventBuilder);

    if (stderr) {
      testEventBuilder.appendMessage('stderr arrived during running this test >>>', null);
      testEventBuilder.appendMessage(stderr, 1);
      testEventBuilder.appendMessage('<<<', null);
    }

    const testEvent = testEventBuilder.build();

    this.lastRunEvent = testEvent;

    return testEvent;
  }

  private _processXmlTagTestCaseInner(testCase: XmlObject, testEventBuilder: TestEventBuilder): void {
    if (testCase.OverallResult[0].$.hasOwnProperty('durationInSeconds')) {
      this.lastRunMilisec = Number(testCase.OverallResult[0].$.durationInSeconds) * 1000;
      testEventBuilder.setDurationMilisec(this.lastRunMilisec);
    }

    testEventBuilder.appendMessage(testCase._, 0);

    const main: Catch2Section = new Catch2Section(testCase.$.name, testCase.$.filename, testCase.$.line);

    this._processTags(testCase, main, [], testEventBuilder);

    this._processXmlTagSections(testCase, main, [], testEventBuilder, main);

    this._sections = main.children;

    if (testCase.OverallResult[0].StdOut) {
      testEventBuilder.appendMessage('⬇ std::cout:', 0);
      for (let i = 0; i < testCase.OverallResult[0].StdOut.length; i++)
        testEventBuilder.appendMessage(testCase.OverallResult[0].StdOut[i], 1);
      testEventBuilder.appendMessage('⬆ std::cout', 0);
    }

    if (testCase.OverallResult[0].StdErr) {
      testEventBuilder.appendMessage('⬇ std::err:', 0);
      for (let i = 0; i < testCase.OverallResult[0].StdErr.length; i++)
        testEventBuilder.appendMessage(testCase.OverallResult[0].StdErr[i], 1);
      testEventBuilder.appendMessage('⬆ std::err', 0);
    }

    if (testCase.OverallResult[0].$.success === 'true') {
      testEventBuilder.passed();
    } else {
      testEventBuilder.failed();
    }

    if (this._sections.length) {
      let failedBranch = 0;
      let succBranch = 0;

      const traverse = (section: Catch2Section): void => {
        if (section.children.length === 0) {
          section.failed ? ++failedBranch : ++succBranch;
        } else {
          for (let i = 0; i < section.children.length; ++i) {
            traverse(section.children[i]);
          }
        }
      };

      this._sections.forEach(section => traverse(section));

      const branchMsg = (failedBranch ? '✘' + failedBranch + '|' : '') + '✔︎' + succBranch;

      testEventBuilder.appendDescription(` [${branchMsg}]`);
      testEventBuilder.appendTooltip(`ᛦ ${branchMsg} branches`);
    }
  }

  private static readonly _expectedPropertyNames = new Set([
    '_',
    '$',
    'Section',
    'Info',
    'Warning',
    'Failure',
    'Expression',
    'Exception',
    'OverallResult',
    'OverallResults',
    'FatalErrorCondition',
    'BenchmarkResults',
  ]);

  private _processTags(
    xml: XmlObject,
    main: Catch2Section,
    stack: Catch2Section[],
    testEventBuilder: TestEventBuilder,
  ): void {
    {
      Object.getOwnPropertyNames(xml).forEach(n => {
        if (!Catch2Test._expectedPropertyNames.has(n)) {
          this._shared.log.error('unexpected Catch2 tag: ' + n);
          testEventBuilder.appendMessage('unexpected Catch2 tag:' + n, 0);
          testEventBuilder.errored();
        }
      });
    }

    testEventBuilder.appendMessage(xml._, 0);

    try {
      if (xml.Info) {
        testEventBuilder.appendMessage('⬇ Info:', 0);
        for (let i = 0; i < xml.Info.length; i++) testEventBuilder.appendMessage(xml.Info[i], 1);
        testEventBuilder.appendMessage('⬆ Info', 0);
      }
    } catch (e) {
      this._shared.log.exception(e);
    }

    try {
      if (xml.Warning) {
        testEventBuilder.appendMessage('⬇ Warning:', 0);
        for (let i = 0; i < xml.Warning.length; i++)
          testEventBuilder.appendMessageWithDecorator(
            xml.Warning[i].$.filename,
            Number(xml.Warning[i].$.line) - 1,
            xml.Warning[i],
            1,
          );
        testEventBuilder.appendMessage('⬆ Warning', 0);
      }
    } catch (e) {
      this._shared.log.exception(e);
    }

    try {
      if (xml.Failure) {
        testEventBuilder.appendMessage('⬇ Failure:', 0);
        for (let i = 0; i < xml.Failure.length; i++) {
          if (typeof xml.Failure[i]._ !== 'string') this._shared.log.warn('No _ under failure', xml.Failure[i]);

          const msg = typeof xml.Failure[i]._ === 'string' ? xml.Failure[i]._.trim() : xml.Failure[i].toString();

          testEventBuilder.appendMessageWithDecorator(
            xml.Failure[i].$.filename,
            Number(xml.Failure[i].$.line) - 1,
            msg,
            1,
          );
        }
        testEventBuilder.appendMessage('⬆ Failure', 0);
      }
    } catch (e) {
      this._shared.log.exception(e);
    }

    try {
      if (xml.BenchmarkResults) {
        for (let i = 0; i < xml.BenchmarkResults.length; i++) {
          this._processBenchmark(xml.BenchmarkResults[i], stack, testEventBuilder);
        }
      }
    } catch (e) {
      this._shared.log.exception(e);
    }

    try {
      if (xml.Expression) {
        for (let j = 0; j < xml.Expression.length; ++j) {
          const expr = xml.Expression[j];
          const message =
            '❕Original:  ' +
            expr.Original.map((x: string) => x.trim()).join('; ') +
            '\n' +
            '❗️Expanded:  ' +
            expr.Expanded.map((x: string) => x.trim()).join('; ');

          testEventBuilder.appendMessage(message, 1);
          testEventBuilder.appendDecorator(
            expr.$.filename,
            Number(expr.$.line) - 1,
            '⬅ ' + expr.Expanded.map((x: string) => x.trim()).join(' | '),
            message,
          );
        }
      }
    } catch (e) {
      this._shared.log.exception(e);
    }

    try {
      for (let j = 0; xml.Exception && j < xml.Exception.length; ++j) {
        if (typeof xml.Exception[j]._ !== 'string') this._shared.log.warn('No _ under exception', xml.Exception[j]);

        const msg = typeof xml.Exception[j]._ === 'string' ? xml.Exception[j]._.trim() : xml.Exception[j].toString();

        testEventBuilder.appendMessageWithDecorator(
          xml.Exception[j].$.filename,
          Number(xml.Exception[j].$.line) - 1,
          `Exception were thrown: "${msg}"`,
          0,
        );
      }
    } catch (e) {
      this._shared.log.exception(e);
    }

    try {
      if (xml.FatalErrorCondition) {
        testEventBuilder.appendMessage('⬇ FatalErrorCondition:', 0);
        for (let j = 0; j < xml.FatalErrorCondition.length; ++j) {
          testEventBuilder.appendMessageWithDecorator(
            xml.FatalErrorCondition[j].$.filename,
            Number(xml.FatalErrorCondition[j].$.line) - 1,
            xml.FatalErrorCondition[j]._,
            0,
          );
        }
        testEventBuilder.appendMessage('⬆ FatalErrorCondition', 0);
      }
    } catch (error) {
      this._shared.log.exception(error);
      testEventBuilder.appendMessage('Unknown fatal error: ' + inspect(error), 0);
    }
  }

  private _processXmlTagSections(
    xml: XmlObject,
    main: Catch2Section,
    stack: Catch2Section[],
    testEventBuilder: TestEventBuilder,
    parentSection: Catch2Section,
  ): void {
    for (let j = 0; xml.Section && j < xml.Section.length; ++j) {
      const section = xml.Section[j];

      try {
        const currSection = ((): Catch2Section => {
          const found = parentSection.children.find(
            v => v.name === section.$.name && v.filename === section.$.filename && v.line === section.$.line,
          );
          if (found) return found;

          const currSection = new Catch2Section(section.$.name, section.$.filename, section.$.line);
          parentSection.children.push(currSection);
          return currSection;
        })();

        const isLeaf = section.Section === undefined || section.Section.length === 0;

        if (
          isLeaf &&
          section.OverallResults &&
          section.OverallResults.length > 0 &&
          section.OverallResults[0].$.failures !== '0'
        ) {
          currSection.failed = true;
        }

        const isSameFile =
          stack.length === 0
            ? currSection.filename === this.file
            : currSection.filename === stack[stack.length - 1].filename;

        const location =
          currSection.filename && !isSameFile
            ? `at ${currSection.filename}:${currSection.line}`
            : `at line ${currSection.line}`;

        const msg = `⮑ ${isLeaf ? (currSection.failed ? ' ❌ ' : ' ✅ ') : ''}"${currSection.name}" (${location})`;

        testEventBuilder.appendMessage(msg, stack.length, 3);

        const currStack = stack.concat(currSection);

        this._processTags(section, main, currStack, testEventBuilder);

        this._processXmlTagSections(section, main, currStack, testEventBuilder, currSection);
      } catch (error) {
        testEventBuilder.appendMessage('Fatal error processing section', 0);
        this._shared.log.exception(error);
      }
    }
  }

  private _processBenchmark(benchmark: XmlObject, stack: Catch2Section[], testEventBuilder: TestEventBuilder): void {
    const currSection = new Catch2Section(benchmark.$.name, undefined, 0);

    const msg = `⮑ benchmark of "${currSection.name}"`;

    testEventBuilder.appendMessage(msg, stack.length, 3);

    for (let j = 0; benchmark.mean && j < benchmark.mean.length; ++j) {
      const mean = benchmark.mean[j].$;
      const params = Object.keys(mean)
        .filter(n => n !== 'value')
        .map(key => `${key}: ${mean[key]} ns`)
        .join(', ');
      testEventBuilder.appendMessage(`Mean: ${mean.value} ns  (${params})`, 2);
    }

    for (let j = 0; benchmark.standardDeviation && j < benchmark.standardDeviation.length; ++j) {
      const standardDeviation = benchmark.standardDeviation[j].$;
      const params = Object.keys(standardDeviation)
        .filter(n => n !== 'value')
        .map(key => `${key}: ${standardDeviation[key]} ns`)
        .join(', ');
      testEventBuilder.appendMessage(`Standard Deviation: ${standardDeviation.value} ns  (${params})`, 2);
    }

    for (let j = 0; benchmark.outliers && j < benchmark.outliers.length; ++j) {
      const outliers = benchmark.outliers[j].$;
      const params = Object.keys(outliers)
        .map(key => `${key}: ${outliers[key]} ns`)
        .join(', ');
      testEventBuilder.appendMessage(`Outliers: ${params}`, 2);
    }

    testEventBuilder.appendMessage(
      'Parameters: ' +
        Object.keys(benchmark.$)
          .filter(n => n !== 'name')
          .map(key => `${key}: ${benchmark.$[key]}`)
          .join(', '),
      2,
    );
  }
}