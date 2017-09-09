'use strict';

const {Engine} = require('../../lib');
const Lab = require('lab');
const testHelpers = require('../helpers/testHelpers');

const lab = exports.lab = Lab.script();
const {beforeEach, describe, it} = lab;
const {expect} = Lab.assertions;

describe('InclusiveGateway', () => {
  describe('behavior', () => {
    const source = `
    <?xml version="1.0" encoding="UTF-8"?>
    <definitions id="Definitions_1" xmlns="http://www.omg.org/spec/BPMN/20100524/MODEL"
       xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:camunda="http://camunda.org/schema/1.0/bpmn" targetNamespace="http://bpmn.io/schema/bpmn">
      <process id="mainProcess" isExecutable="true">
        <startEvent id="start" />
        <inclusiveGateway id="decisions" default="defaultFlow">
          <extensionElements>
            <camunda:InputOutput>
              <camunda:inputParameter name="takeCondition1">\${variables.condition1}</camunda:inputParameter>
              <camunda:outputParameter name="enteredDecision">Yes</camunda:outputParameter>
            </camunda:InputOutput>
          </extensionElements>
        </inclusiveGateway>
        <endEvent id="end1" />
        <endEvent id="end2" />
        <endEvent id="end3" />
        <sequenceFlow id="flow1" sourceRef="start" targetRef="decisions" />
        <sequenceFlow id="defaultFlow" sourceRef="decisions" targetRef="end2" />
        <sequenceFlow id="condFlow1" sourceRef="decisions" targetRef="end1">
          <conditionExpression xsi:type="tFormalExpression">\${takeCondition1}</conditionExpression>
        </sequenceFlow>
        <sequenceFlow id="condFlow2" sourceRef="decisions" targetRef="end3">
          <conditionExpression xsi:type="tFormalExpression">\${variables.condition2}</conditionExpression>
        </sequenceFlow>
      </process>
    </definitions>`;

    let context;
    beforeEach((done) => {
      testHelpers.getContext(source, {
        camunda: require('camunda-bpmn-moddle/resources/camunda')
      }, (err, c) => {
        if (err) return done(err);
        context = c;
        done();
      });
    });

    it('variables and services are passed to conditional flow', (done) => {
      context.environment.assignVariables({condition1: true});

      const gateway = context.getChildActivityById('decisions');
      gateway.activate();

      gateway.outbound.find((f) => f.id === 'condFlow1').once('taken', () => {
        done();
      });

      gateway.inbound[0].take();
    });

    it('end returns output in callback', (done) => {
      context.environment.assignVariables({condition1: false});

      const gateway = context.getChildActivityById('decisions');
      gateway.activate();

      gateway.once('end', (activity, executionContext) => {
        expect(executionContext.getOutput()).to.equal({
          enteredDecision: 'Yes'
        });
        done();
      });

      gateway.inbound[0].take();
    });

    it('discards default outbound if one outbound was taken', (done) => {
      context.environment.assignVariables({condition2: true});

      const gateway = context.getChildActivityById('decisions');
      gateway.activate();

      const discardedFlows = [];
      gateway.outbound.forEach((f) => {
        f.once('discarded', () => {
          discardedFlows.push(f.id);
        });
      });

      gateway.once('leave', () => {
        expect(discardedFlows, 'discarded flows').to.equal(['condFlow1', 'defaultFlow']);
        done();
      });

      gateway.inbound[0].take();
    });

    it('discards default outbound if more than one outbound was taken', (done) => {
      context.environment.assignVariables({
        condition1: true,
        condition2: true
      });

      const gateway = context.getChildActivityById('decisions');
      gateway.activate();

      const discardedFlows = [];
      gateway.outbound.forEach((f) => {
        f.once('discarded', () => {
          discardedFlows.push(f.id);
        });
      });

      gateway.once('leave', () => {
        expect(discardedFlows, 'discarded flows').to.equal(['defaultFlow']);
        done();
      });

      gateway.inbound[0].take();
    });

    it('discards all outbound if inbound was discarded', (done) => {
      const gateway = context.getChildActivityById('decisions');
      gateway.activate();

      const discardedFlows = [];
      gateway.outbound.forEach((f) => {
        f.once('discarded', () => {
          discardedFlows.push(f.id);

          if (gateway.outbound.length === discardedFlows.length) {
            done();
          }
        });
      });

      gateway.inbound[0].discard();
    });

    describe('resume()', () => {
      it('sets resumed gateway pendingOutbound', (done) => {
        context.environment.assignVariables({condition2: true});

        const gateway = context.getChildActivityById('decisions');

        gateway.on('start', (activityApi, activityExecution) => {

          gateway.outbound[1].once('discarded', () => {
            const api = activityApi.getApi(activityExecution);
            api.stop();

            const state = api.getState();

            expect(state).to.include({
              discardedOutbound: ['condFlow1'],
              pendingOutbound: ['defaultFlow', 'condFlow2']
            });

            const clonedContext = context.clone();
            const resumedGateway = clonedContext.getChildActivityById('decisions');
            const resumedGatewayApi = resumedGateway.activate(state);
            resumedGatewayApi.id += '-resumed';

            resumedGateway.once('enter', (resumedActivityApi, resumedActivityExecution) => {
              const resumedApi = resumedActivityApi.getApi(resumedActivityExecution);
              resumedApi.stop();

              expect(resumedApi.getState().pendingOutbound).to.equal(['defaultFlow', 'condFlow2']);
              done();
            });

            resumedGatewayApi.resume();
          });
        });

        gateway.activate();
        gateway.inbound[0].take();
      });

      it('discards defaultFlow if other flows were taken', (done) => {
        context.environment.assignVariables({
          condition1: true,
          condition2: true
        });

        const gateway = context.getChildActivityById('decisions');

        const flowSequence = [];
        gateway.outbound.forEach((f) => {
          f.on('taken', (flow) => {
            flowSequence.push(`taken-${flow.id}`);
          });
          f.on('discarded', (flow) => {
            flowSequence.push(`discarded-${flow.id}`);
          });
        });

        gateway.once('start', (activityApi, activityExecution) => {
          gateway.outbound[1].once('taken', () => {
            const api = activityApi.getApi(activityExecution);
            api.stop();

            const state = api.getState();

            expect(state).to.include({
              pendingOutbound: ['defaultFlow', 'condFlow2']
            });

            const clonedContext = context.clone();
            const resumedGateway = clonedContext.getChildActivityById('decisions');
            const resumedGatewayApi = resumedGateway.activate(state);
            resumedGatewayApi.id += '-resumed';

            resumedGateway.once('leave', (g) => {
              const defaultFlow = g.outbound.find((f) => f.isDefault);
              expect(defaultFlow.discarded, defaultFlow.id).to.be.true();
              expect(defaultFlow.taken, defaultFlow.id).to.be.undefined();

              expect(flowSequence).to.equal(['taken-condFlow1', 'taken-condFlow2', 'discarded-defaultFlow']);

              done();
            });

            resumedGatewayApi.resume();
          });
        });

        gateway.activate();
        gateway.inbound[0].take();
      });

      it('takes defaultFlow if no other flows were taken', (done) => {
        const gateway = context.getChildActivityById('decisions');

        const flowSequence = [];
        gateway.outbound.forEach((f) => {
          f.on('taken', (flow) => {
            flowSequence.push(`taken-${flow.id}`);
          });
          f.on('discarded', (flow) => {
            flowSequence.push(`discarded-${flow.id}`);
          });
        });

        gateway.once('start', (activityApi, activityExecution) => {
          gateway.outbound[1].once('discarded', () => {
            const api = activityApi.getApi(activityExecution);
            api.stop();

            const state = api.getState();

            const clonedContext = context.clone();
            const resumedGateway = clonedContext.getChildActivityById('decisions');
            const resumedGatewayApi = resumedGateway.activate(state);
            resumedGatewayApi.id += '-resumed';

            resumedGateway.once('leave', (g) => {
              const defaultFlow = g.outbound.find((f) => f.isDefault);
              expect(defaultFlow.taken, defaultFlow.id).to.be.true();

              expect(flowSequence).to.equal(['discarded-condFlow1', 'discarded-condFlow2', 'taken-defaultFlow']);

              done();
            });

            resumedGatewayApi.resume(state);
          });
        });

        gateway.activate();
        gateway.inbound[0].take();
      });
    });
  });

  describe('engine', () => {
    it('should support multiple conditional flows, case 1', (done) => {
      const source = `
      <?xml version="1.0" encoding="UTF-8"?>
        <definitions xmlns="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
        <process id="theProcess" isExecutable="true">
          <startEvent id="theStart" />
          <inclusiveGateway id="decision" />
          <endEvent id="theEnd1" />
          <endEvent id="theEnd2" />
          <endEvent id="theEnd3" />
          <sequenceFlow id="flow1" sourceRef="theStart" targetRef="decision" />
          <sequenceFlow id="flow2" sourceRef="decision" targetRef="theEnd1" />
          <sequenceFlow id="flow3" sourceRef="decision" targetRef="theEnd2">
            <conditionExpression xsi:type="tFormalExpression" language="JavaScript"><![CDATA[
            this.variables.input <= 50
            ]]></conditionExpression>
          </sequenceFlow>
          <sequenceFlow id="flow4" sourceRef="decision" targetRef="theEnd3">
            <conditionExpression xsi:type="tFormalExpression" language="JavaScript"><![CDATA[
            this.variables.input <= 20
            ]]></conditionExpression>
          </sequenceFlow>
        </process>
      </definitions>`;

      const engine = new Engine({
        source
      });
      engine.execute({
        variables: {
          input: 1
        }
      }, (err, execution) => {
        if (err) return done(err);

        expect(execution.getChildState('theEnd1').taken, 'theEnd1').to.be.true();
        expect(execution.getChildState('theEnd2').taken, 'theEnd2').to.be.true();
        expect(execution.getChildState('theEnd3').taken, 'theEnd3').to.be.true();
        done();
      });
    });

    it('should support the default flow in combination with multiple conditional flows, case condition met', (done) => {
      const source = `
      <?xml version="1.0" encoding="UTF-8"?>
        <definitions xmlns="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
        <process id="theProcess" isExecutable="true">
          <startEvent id="theStart" />
          <inclusiveGateway id="decision" default="flow2" />
          <endEvent id="theEnd1" />
          <endEvent id="theEnd2" />
          <endEvent id="theEnd3" />
          <sequenceFlow id="flow1" sourceRef="theStart" targetRef="decision" />
          <sequenceFlow id="flow2" sourceRef="decision" targetRef="theEnd1" />
          <sequenceFlow id="flow3" sourceRef="decision" targetRef="theEnd2">
            <conditionExpression xsi:type="tFormalExpression" language="JavaScript"><![CDATA[
            this.variables.input <= 50
            ]]></conditionExpression>
          </sequenceFlow>
          <sequenceFlow id="flow4" sourceRef="decision" targetRef="theEnd3">
            <conditionExpression xsi:type="tFormalExpression" language="JavaScript"><![CDATA[
            this.variables.input <= 20
            ]]></conditionExpression>
          </sequenceFlow>
        </process>
      </definitions>`;

      const engine = new Engine({
        source
      });
      engine.execute({
        variables: {
          input: 50
        }
      }, (err, execution) => {
        if (err) return done(err);

        expect(execution.getChildState('theEnd1').taken, 'theEnd1').to.be.undefined();
        expect(execution.getChildState('theEnd2').taken, 'theEnd2').to.be.true();
        expect(execution.getChildState('theEnd3').taken, 'theEnd3').to.be.undefined();

        testHelpers.expectNoLingeringListenersOnEngine(engine);

        done();
      });
    });

    it('should support the default flow in combination with multiple conditional flows, case no conditions met', (done) => {
      const source = `
      <?xml version="1.0" encoding="UTF-8"?>
        <definitions xmlns="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
        <process id="theProcess" isExecutable="true">
          <startEvent id="theStart" />
          <inclusiveGateway id="decision" default="flow2" />
          <endEvent id="theEnd1" />
          <endEvent id="theEnd2" />
          <endEvent id="theEnd3" />
          <sequenceFlow id="flow1" sourceRef="theStart" targetRef="decision" />
          <sequenceFlow id="flow2" sourceRef="decision" targetRef="theEnd1" />
          <sequenceFlow id="flow3" sourceRef="decision" targetRef="theEnd2">
            <conditionExpression xsi:type="tFormalExpression" language="JavaScript"><![CDATA[
            this.variables.input <= 50
            ]]></conditionExpression>
          </sequenceFlow>
          <sequenceFlow id="flow4" sourceRef="decision" targetRef="theEnd3">
            <conditionExpression xsi:type="tFormalExpression" language="JavaScript"><![CDATA[
            this.variables.input <= 20
            ]]></conditionExpression>
          </sequenceFlow>
        </process>
      </definitions>`;

      const engine = new Engine({
        source
      });
      engine.execute({
        variables: {
          input: 60
        }
      }, (err, execution) => {
        if (err) return done(err);

        expect(execution.getChildState('theEnd1').taken, 'theEnd1').to.be.true();
        expect(execution.getChildState('theEnd2').taken, 'theEnd2').to.be.undefined();
        expect(execution.getChildState('theEnd3').taken, 'theEnd3').to.be.undefined();

        testHelpers.expectNoLingeringListenersOnEngine(engine);

        done();
      });
    });

    it('emits error when no conditional flow is taken', (done) => {
      const source = `
      <?xml version="1.0" encoding="UTF-8"?>
        <definitions xmlns="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
        <process id="theProcess" isExecutable="true">
          <startEvent id="theStart" />
          <inclusiveGateway id="decision" />
          <endEvent id="theEnd1" />
          <endEvent id="theEnd2" />
          <sequenceFlow id="flow1" sourceRef="theStart" targetRef="decision" />
          <sequenceFlow id="flow2" sourceRef="decision" targetRef="theEnd1">
            <conditionExpression xsi:type="tFormalExpression" language="JavaScript"><![CDATA[
            this.variables.input <= 50
            ]]></conditionExpression>
          </sequenceFlow>
          <sequenceFlow id="flow3" sourceRef="decision" targetRef="theEnd2">
            <conditionExpression xsi:type="tFormalExpression" language="JavaScript"><![CDATA[
            this.variables.input <= 20
            ]]></conditionExpression>
          </sequenceFlow>
        </process>
      </definitions>`;

      const engine = new Engine({
        source
      });
      engine.once('error', (err) => {
        expect(err).to.be.an.error(/no conditional flow/i);

        testHelpers.expectNoLingeringListenersOnEngine(engine);

        done();
      });

      engine.execute({
        variables: {
          input: 61
        }
      });
    });
  });
});
