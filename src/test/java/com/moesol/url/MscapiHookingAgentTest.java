package com.moesol.url;

import static org.junit.Assert.*;

import org.junit.Test;

public class MscapiHookingAgentTest {

	@Test
	public void test() {
		MscapiHookingAgent.processArgs("");
		assertEquals(false, MscapiHookingAgent.DEBUG);
		assertEquals("TLS", MscapiHookingAgent.CONTEXT);
		
		MscapiHookingAgent.processArgs("load,debug,context=SSLv3");
		assertEquals(true, MscapiHookingAgent.DEBUG);
		assertEquals("SSLv3", MscapiHookingAgent.CONTEXT);
	}

}
