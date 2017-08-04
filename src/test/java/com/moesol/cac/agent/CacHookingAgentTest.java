package com.moesol.url;

import static org.junit.Assert.*;

import org.junit.Test;

public class CacHookingAgentTest {

	@Test
	public void test() {
		Config config = new Config();
		CacHookingAgent.processArgs("", config);
		assertEquals(false, CacHookingAgent.DEBUG);
		assertEquals("TLS", CacHookingAgent.CONTEXT);
		
		CacHookingAgent.processArgs("load,debug,context=SSLv3", config);
		assertEquals(true, CacHookingAgent.DEBUG);
		assertEquals("SSLv3", CacHookingAgent.CONTEXT);
		
		config.setUseWindowsTrust(false);
		CacHookingAgent.processArgs("load,debug,windowsTrust,context=SSLv3", config);
		assertTrue(config.isUseWindowsTrust());
	}

}
