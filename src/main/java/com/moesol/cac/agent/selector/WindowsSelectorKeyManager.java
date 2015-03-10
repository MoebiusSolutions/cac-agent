package com.moesol.cac.agent.selector;

import java.security.KeyStore;

import com.moesol.url.CacHookingAgent;

public class WindowsSelectorKeyManager extends SwingSelectorKeyManager {
	
	protected KeyStore accessKeyStore() throws Exception {
		KeyStore result = KeyStore.getInstance("Windows-MY");
		result.load(null, null);
		return result;
	}

	public static void main(String[] args) {
		CacHookingAgent.DEBUG = true;
		System.out.println("chose: " + new WindowsSelectorKeyManager().chooseClientAlias(null, null, null));
		System.exit(0);
	}

}
