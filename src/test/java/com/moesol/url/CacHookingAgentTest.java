package com.moesol.url;

import static org.junit.Assert.*;

import org.junit.Test;

public class CacHookingAgentTest {

	@Test
	public void test() {
		CacHookingAgent.processArgs("");
		assertEquals(false, CacHookingAgent.DEBUG);
		assertEquals("TLS", CacHookingAgent.CONTEXT);
		
		CacHookingAgent.processArgs("load,debug,context=SSLv3");
		assertEquals(true, CacHookingAgent.DEBUG);
		assertEquals("SSLv3", CacHookingAgent.CONTEXT);
	}

}
