import test from 'node:test';
import assert from 'node:assert/strict';
import { parseSalaryText, extractSalaries, suggestSalary } from '../src/salary-extractor.js';
import { sourceVariants } from '../src/capture-rules.js';

test('salary formats preserve ranges, currency, periods and one-sided bounds', () => {
  const cases = [
    ['70K PHP/month - 95K PHP/month',70000,95000,'PHP','MONTH'],
    ['₱30K–₱45K/month + commission',30000,45000,'PHP','MONTH'],
    ['PHP 30,000 – PHP 45,000 per month',30000,45000,'PHP','MONTH'],
    ['Up to PHP 80,000 per month',null,80000,'PHP','MONTH'],
    ['From ₱30,000 monthly',30000,null,'PHP','MONTH'],
    ['Starting at USD 25 per hour',25,null,'USD','HOUR'],
    ['At least EUR 70.000 per year',70000,null,'EUR','YEAR'],
    ['US$20.50 - US$30.75 an hour',20.5,30.75,'USD','HOUR'],
    ['$20 - $30 an hour',20,30,null,'HOUR'],
    ['Salary: 30,000 - 45,000 a month',30000,45000,null,'MONTH'],
    ['Salary: PHP 30-45k monthly',30000,45000,'PHP','MONTH'],
    ['Salary: SGD 3,500 per month',3500,3500,'SGD','MONTH'],
    ['Salary: RM 5,000 - RM 6,000 a month',5000,6000,'MYR','MONTH'],
    ['Salary: Rp 10.000.000 per month',10000000,10000000,'IDR','MONTH'],
    ['GBP 50,000 - 60,000',50000,60000,'GBP',null]
  ];
  for (const [text,...expected] of cases) {
    const actual = parseSalaryText(text);
    assert.ok(actual,text);
    assert.deepEqual([actual.salary_min,actual.salary_max,actual.salary_currency,actual.salary_period],expected,text);
    assert.equal(actual.raw_text,text);
  }
});

test('ambiguous salaries, bonuses, estimates and PHP developer titles stay unknown', () => {
  for (const text of ['PHP 8 Developer','Bonus: PHP 10000','Estimated salary: PHP 50K/month','OTE: USD 100K/year','Salary: PHP 40K - PHP 30K monthly','Salary: PHP 30K - USD 40K monthly','Salary: PHP 30K/month or PHP 400K/year','Salary negotiable','3 years of experience']) assert.equal(parseSalaryText(text),null,text);
  assert.equal(parseSalaryText('Our customers generate USD 3000000 in revenue.',{description:true}),null);
  assert.equal(parseSalaryText('Please supply your expected salary: PHP 50000 per month'),null);
});

function candidate(evidence,posting = {}) {
  return {posting:{job_platform:'LINKEDIN',salary_min:null,salary_max:null,salary_currency:null,salary_period:null,...posting},provenance:{},source:{rendered_text:'Build services.',salary_evidence:evidence}};
}
test('selected salary fields take precedence over descriptions and preserve source evidence', () => {
  const c = candidate([{kind:'salary-field',text:'₱30K–₱45K/month + commission',locator:'#salary'},{kind:'description',text:'Salary: PHP 400K per year',locator:'#description'}]);
  extractSalaries({candidates:[c]});
  assert.equal(c.posting.salary_min,30000);assert.equal(c.posting.salary_max,45000);
  assert.equal(c.provenance.salary_min.locator,'#salary');
  assert.match(sourceVariants(c)[0].text,/₱30K–₱45K\/month \+ commission/);
  const structured = candidate(c.source.salary_evidence,{salary_min:50000,salary_max:60000,salary_currency:'USD',salary_period:'YEAR'});
  extractSalaries({candidates:[structured]});assert.equal(structured.posting.salary_min,50000);assert.equal(structured.posting.salary_period,'YEAR');
});

test('AI receives only salary excerpts and verified output is reviewable', async () => {
  const c = candidate([{text:'Private unrelated description\nBase compensation: PHP 30000 to PHP 45000 monthly',kind:'description'}]);
  const suggestion = await suggestSalary(c,{},async (_settings,messages) => {
    assert.doesNotMatch(messages[1].content,/Private unrelated/);
    return {data:{salary_min:30000,salary_max:45000,salary_currency:'PHP',salary_period:'MONTH',quote:'PHP 30000 to PHP 45000 monthly'}};
  });
  assert.equal(suggestion.salary_max,45000);
  for (const patch of [{salary_min:99999},{salary_currency:'USD'},{salary_period:'YEAR'},{quote:'invented salary'},{salary_min:-1}]) await assert.rejects(suggestSalary(c,{},async()=>({data:{...suggestion,...patch}})));
  await assert.rejects(suggestSalary(c,{},async()=>({data:{...suggestion,salary_max:30000}})));
});
