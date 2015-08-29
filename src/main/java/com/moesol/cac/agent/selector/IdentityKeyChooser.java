package com.moesol.cac.agent.selector;

import java.lang.reflect.InvocationTargetException;

public interface IdentityKeyChooser {
	String chooseFromAliases(final String[] aliases) throws InvocationTargetException, InterruptedException;
	void reportException(final Exception e);
}
